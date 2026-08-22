import { afterEach, describe, expect, it } from "vitest";
import { buildServer, type ServerRuntime } from "../src/app.js";

const runtimes: ServerRuntime[] = [];

const start = async () => {
  const runtime = buildServer({ databasePath: ":memory:", heartbeatIntervalMs: 250 });
  runtimes.push(runtime);
  const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  return { runtime, address };
};

afterEach(async () => Promise.all(runtimes.splice(0).map((runtime) => runtime.close())));

const readSse = async (url: string, count: number, headers?: HeadersInit) => {
  const abort = new AbortController();
  const response = await fetch(url, { headers, signal: abort.signal });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ id?: string; event?: string; data?: unknown; comment?: string }> = [];
  let buffer = "";
  const deadline = setTimeout(() => abort.abort(), 2_000);
  try {
    while (events.length < count) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event: { id?: string; event?: string; data?: unknown; comment?: string } = {};
        for (const line of block.split("\n")) {
          if (line.startsWith(":")) event.comment = line.slice(1).trim();
          else if (line.startsWith("id:")) event.id = line.slice(3).trim();
          else if (line.startsWith("event:")) event.event = line.slice(6).trim();
          else if (line.startsWith("data:")) event.data = JSON.parse(line.slice(5));
        }
        events.push(event);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(deadline);
    abort.abort();
    await reader.cancel().catch(() => undefined);
  }
  return events;
};

describe("安全 SSE 更新", () => {
  it("按 Last-Event-ID 回放且隔离观战权限", async () => {
    const { runtime, address } = await start();
    await fetch(`${address}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: "good-win", gameId: "sse-replay" }),
    });
    await fetch(`${address}/api/sessions/sse-replay/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "step" }),
    });
    const publicEvents = await readSse(`${address}/api/sessions/sse-replay/events?view=public`, 1, {
      "last-event-id": "1",
    });
    expect(publicEvents[0]?.id).toBe("2");
    expect(JSON.stringify(publicEvents)).not.toMatch(/death_detail|roleId|wolf_chat/);

    const godEvents = await readSse(`${address}/api/sessions/sse-replay/events?view=god`, 1, {
      "last-event-id": "1",
    });
    expect(godEvents[0]?.id).toBe("2");
    expect(JSON.stringify(godEvents)).toContain("roleId");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.registry.subscriberCount()).toBe(0);
  });

  it("连接后收到实时更新且不会重复序列", async () => {
    const { address } = await start();
    await fetch(`${address}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: "good-win", gameId: "sse-live" }),
    });
    const reading = readSse(`${address}/api/sessions/sse-live/events?view=public`, 1, { "last-event-id": "1" });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await fetch(`${address}/api/sessions/sse-live/control`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "step" }),
    });
    const events = await reading;
    expect(events.map((event) => event.id)).toEqual(["2"]);
  });

  it("发送心跳并拒绝非法视角", async () => {
    const { address } = await start();
    await fetch(`${address}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: "good-win", gameId: "sse-heartbeat" }),
    });
    const heartbeat = await readSse(`${address}/api/sessions/sse-heartbeat/events?view=public`, 1, { "last-event-id": "1" });
    expect(heartbeat[0]?.comment).toBe("heartbeat");
    expect((await fetch(`${address}/api/sessions/sse-heartbeat/events?view=seat:99`)).status).toBe(400);
  });

  it("客户端序列超前时回退到当前安全快照", async () => {
    const { address } = await start();
    await fetch(`${address}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: "good-win", gameId: "sse-reset" }),
    });
    const events = await readSse(`${address}/api/sessions/sse-reset/events?view=public`, 1, {
      "last-event-id": "999",
    });
    expect(events[0]?.id).toBe("1");
    expect(JSON.stringify(events)).not.toContain("roleId");
  });
});
