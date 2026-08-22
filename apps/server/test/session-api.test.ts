import { afterEach, describe, expect, it } from "vitest";
import { buildServer, type ServerRuntime } from "../src/app.js";

const runtimes: ServerRuntime[] = [];

const createApp = () => {
  const runtime = buildServer({ databasePath: ":memory:" });
  runtimes.push(runtime);
  return runtime.app;
};

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe("本地对局 REST API", () => {
  it("创建固定六人局且不接受客户端角色", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { seed: "good-win", roles: ["werewolf"] },
    });
    expect(response.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { seed: "good-win", gameId: "api-good" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().view.mode).toEqual({ kind: "public" });
    expect(created.json().view.seats).toHaveLength(6);
    expect(JSON.stringify(created.json())).not.toContain("role_assigned");
  });

  it("支持列表、读取和单步控制", async () => {
    const app = createApp();
    await app.inject({ method: "POST", url: "/api/sessions", payload: { seed: "good-win", gameId: "api-step" } });

    const list = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(list.statusCode).toBe(200);
    expect(list.json().sessions).toHaveLength(1);

    const before = await app.inject({ method: "GET", url: "/api/sessions/api-step" });
    const stepped = await app.inject({ method: "POST", url: "/api/sessions/api-step/control", payload: { type: "step" } });
    expect(stepped.statusCode).toBe(200);
    expect(stepped.json().view.version).toBe(before.json().view.version + 1);
    expect(stepped.json().runner).toEqual({ mode: "paused", inFlight: false });
  });

  it("映射非法请求、缺失会话和重复创建", async () => {
    const app = createApp();
    expect((await app.inject({ method: "POST", url: "/api/sessions", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/sessions/missing" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/sessions/missing/control", payload: { type: "pause" } })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: "/api/sessions", payload: { seed: "good-win", gameId: "same" } });
    expect((await app.inject({ method: "POST", url: "/api/sessions", payload: { seed: "good-win", gameId: "same" } })).statusCode).toBe(409);
  });

  it("并发恢复控制保持单写者", async () => {
    const app = createApp();
    await app.inject({ method: "POST", url: "/api/sessions", payload: { seed: "good-win", gameId: "api-run" } });
    const results = await Promise.all(Array.from({ length: 3 }, () => app.inject({
      method: "POST",
      url: "/api/sessions/api-run/control",
      payload: { type: "resume" },
    })));
    expect(results.every((response) => response.statusCode === 200)).toBe(true);
    const final = await app.inject({ method: "GET", url: "/api/sessions/api-run" });
    expect(final.json().view.outcome).toBe("good_win");
  });
});
