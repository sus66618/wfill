import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children: ChildProcess[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const freePort = async (): Promise<number> => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("ephemeral_port_unavailable"));
    server.close(() => resolvePort(address.port));
  });
});

const waitForHealth = async (baseUrl: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("server_health_timeout");
};

const launch = async (port: number, dataDirectory: string): Promise<ChildProcess> => {
  const child = spawn(process.execPath, [resolve("apps/server/dist/index.js")], {
    cwd: resolve("."),
    env: { ...process.env, WFILL_PORT: String(port), WFILL_DATA_DIR: dataDirectory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  await waitForHealth(`http://127.0.0.1:${port}`);
  return child;
};

const stop = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
};

const readTerminalReplay = async (url: string): Promise<unknown[]> => {
  const abort = new AbortController();
  const response = await fetch(url, { signal: abort.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const updates: unknown[] = [];
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.split("\n").find((line) => line.startsWith("data:"));
        if (data) {
          const update = JSON.parse(data.slice(5));
          updates.push(update);
          if (update.type === "view_snapshot" && update.view.outcome !== null) return updates;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    abort.abort();
    await reader.cancel().catch(() => undefined);
  }
  throw new Error("terminal_update_missing");
};

describe("编译产物本地对局", () => {
  it("完成对局并在进程重启后精确恢复公开视图", async () => {
    const scripts = JSON.parse(readFileSync(resolve("package.json"), "utf8")).scripts;
    expect(scripts["start:server"]).toBe("node apps/server/dist/index.js");

    const port = await freePort();
    const dataDirectory = mkdtempSync(join(tmpdir(), "wfill-e2e-"));
    directories.push(dataDirectory);
    const first = await launch(port, dataDirectory);
    const baseUrl = `http://127.0.0.1:${port}`;

    expect((await fetch(`${baseUrl}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: "good-win", gameId: "black-box-good" }),
    })).status).toBe(201);
    const completed = await fetch(`${baseUrl}/api/sessions/black-box-good/control`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "resume" }),
    });
    expect(completed.status).toBe(200);
    const finalPublicView = (await completed.json()).view;
    const publicTranscript = await readTerminalReplay(`${baseUrl}/api/sessions/black-box-good/events?view=public`);
    const godTranscript = await readTerminalReplay(`${baseUrl}/api/sessions/black-box-good/events?view=god`);
    expect(finalPublicView.outcome).toBe("good_win");
    expect(JSON.stringify(publicTranscript)).not.toMatch(/poison|wolf_kill|role_assigned/);
    expect(JSON.stringify(godTranscript)).toContain("death_detail");

    await fetch(`${baseUrl}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: "good-win", gameId: "mid-game-recovery" }),
    });
    await fetch(`${baseUrl}/api/sessions/mid-game-recovery/control`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "step" }),
    });

    await stop(first);
    const second = await launch(port, dataDirectory);
    const recovered = await fetch(`${baseUrl}/api/sessions/black-box-good`);
    expect((await recovered.json()).view).toEqual(finalPublicView);
    const resumed = await fetch(`${baseUrl}/api/sessions/mid-game-recovery/control`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "resume" }),
    });
    expect((await resumed.json()).view.outcome).toBe("good_win");
    await stop(second);
  }, 20_000);
});
