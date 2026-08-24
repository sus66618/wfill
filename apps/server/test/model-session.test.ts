import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GOOD_WIN_SCRIPT } from "../../../packages/game-engine/test/fixtures/good-win-script.js";
import type { ModelAccount, ModelCallRequest, ModelCallResult } from "@wfill/model-gateway";
import { buildServer, type ServerRuntime } from "../src/app.js";
import type { ModelRuntimeGateway } from "../src/runtime/model-runtime.js";

const runtimes: ServerRuntime[] = [];
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

class FakeModelGateway implements ModelRuntimeGateway {
  constructor(private readonly outputs: readonly string[] = []) {}
  private cursor = 0;
  async checkModel(_account: ModelAccount, modelId: string): Promise<ModelCallResult> {
    return { callId: `health:${modelId}`, content: "OK", inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason: "stop" };
  }

  async generate(request: ModelCallRequest): Promise<ModelCallResult> {
    const content = this.outputs[this.cursor++] ?? "过。";
    return { callId: request.callId, content, inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason: "stop" };
  }
}

const outputFor = (command: (typeof GOOD_WIN_SCRIPT.commands)[number]): string => command.type === "submit_speech"
  ? command.content
  : JSON.stringify({ action: command.type, ...( "targetSeat" in command ? { targetSeat: command.targetSeat } : {}) });

const goodWinOutputs = GOOD_WIN_SCRIPT.commands.map(outputFor);

const seats = Array.from({ length: 6 }, (_, index) => ({
  seat: index + 1,
  accountId: "school-account",
  modelId: "Qwen3.5-9B",
}));

const setup = async () => {
  const runtime = buildServer({
    databasePath: ":memory:",
    environment: { WFILL_SCHOOL_API_KEY: "test-only-key" },
    modelGateway: new FakeModelGateway(),
  });
  runtimes.push(runtime);
  await runtime.app.inject({ method: "POST", url: "/api/models/check-all" });
  return runtime;
};

describe("模型座位对局", () => {
  it("允许六个座位复用健康模型且不在对局视图暴露模型身份", async () => {
    const runtime = await setup();
    const response = await runtime.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { controller: "models", seed: "model-game", seats },
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.stringify(response.json())).not.toMatch(/Qwen|school-account|provider|credential/i);
  });

  it.each([
    ["缺少座位", seats.slice(0, 5)],
    ["重复座位", [...seats.slice(0, 5), seats[0]]],
  ])("拒绝%s", async (_label, invalidSeats) => {
    const runtime = await setup();
    const response = await runtime.app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { controller: "models", seats: invalidSeats },
    });
    expect(response.statusCode).toBe(400);
  });

  it("拒绝未知模型和客户端注入角色或密钥字段", async () => {
    const runtime = await setup();
    const unknown = await runtime.app.inject({
      method: "POST", url: "/api/sessions",
      payload: { controller: "models", seats: seats.map((item, index) => index === 0 ? { ...item, modelId: "unknown" } : item) },
    });
    expect(unknown.statusCode).toBe(409);
    const injected = await runtime.app.inject({
      method: "POST", url: "/api/sessions",
      payload: { controller: "models", seats, roles: ["wolf"], credentialRef: "evil" },
    });
    expect(injected.statusCode).toBe(400);
  });

  it("模型控制器可完成六人局且重启后不重放已处理命令", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wfill-model-session-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "game.sqlite");
    const first = buildServer({
      databasePath,
      environment: { WFILL_SCHOOL_API_KEY: "test-only-key" },
      modelGateway: new FakeModelGateway(goodWinOutputs),
    });
    runtimes.push(first);
    await first.app.inject({ method: "POST", url: "/api/models/check-all" });
    const created = await first.app.inject({
      method: "POST", url: "/api/sessions",
      payload: { gameId: "model-restart", controller: "models", seed: "good-win", seats },
    });
    expect(created.statusCode).toBe(201);
    await first.app.inject({ method: "POST", url: "/api/sessions/model-restart/control", payload: { type: "step" } });
    expect(first.registry.repository.load("model-restart")?.state.processedCommandIds).toHaveLength(1);
    await first.close();

    const second = buildServer({
      databasePath,
      environment: { WFILL_SCHOOL_API_KEY: "test-only-key" },
      modelGateway: new FakeModelGateway(goodWinOutputs.slice(1)),
    });
    runtimes.push(second);
    const completed = await second.app.inject({
      method: "POST", url: "/api/sessions/model-restart/control", payload: { type: "resume" },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().runner.mode).toBe("finished");
    expect(completed.json().view.outcome).toBe("good_win");
    expect(second.registry.repository.load("model-restart")?.state.processedCommandIds)
      .toHaveLength(GOOD_WIN_SCRIPT.commands.length);
  });

  it("重启后密钥缺失时保持状态并暂停", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wfill-model-no-key-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "game.sqlite");
    const first = buildServer({
      databasePath,
      environment: { WFILL_SCHOOL_API_KEY: "test-only-key" },
      modelGateway: new FakeModelGateway(goodWinOutputs),
    });
    runtimes.push(first);
    await first.app.inject({ method: "POST", url: "/api/models/check-all" });
    await first.app.inject({
      method: "POST", url: "/api/sessions",
      payload: { gameId: "model-no-key", controller: "models", seed: "good-win", seats },
    });
    await first.close();

    const second = buildServer({ databasePath, environment: {}, modelGateway: new FakeModelGateway(goodWinOutputs) });
    runtimes.push(second);
    const before = second.registry.repository.load("model-no-key")!.state.version;
    const response = await second.app.inject({
      method: "POST", url: "/api/sessions/model-no-key/control", payload: { type: "resume" },
    });
    expect(response.json().runner.mode).toBe("paused");
    expect(second.registry.repository.load("model-no-key")!.state.version).toBe(before);
  });
});
