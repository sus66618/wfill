import { afterEach, describe, expect, it } from "vitest";
import { buildServer, type ServerRuntime } from "../src/app.js";
import {
  EnvCredentialVault,
  OpenAiCompatibleClient,
  type ModelAccount,
  type ModelCallRequest,
  type ModelCallResult,
} from "@wfill/model-gateway";
import type { ModelRuntimeGateway } from "../src/runtime/model-runtime.js";

const runLive = process.env.WFILL_RUN_LIVE_MODEL_TESTS === "1";
const runGame = runLive && process.env.WFILL_RUN_LIVE_MODEL_GAME === "1";
const selectedModel = process.env.WFILL_LIVE_MODEL_ID ?? "Qwen3.5-9B";
const runtimes: ServerRuntime[] = [];
afterEach(async () => Promise.all(runtimes.splice(0).map((runtime) => runtime.close())));

class BudgetedLiveGateway implements ModelRuntimeGateway {
  calls = 0;
  totalTokens = 0;

  constructor(private readonly client: OpenAiCompatibleClient) {}

  async checkModel(account: ModelAccount, modelId: string, signal?: AbortSignal): Promise<ModelCallResult> {
    return this.client.checkModel(account, modelId, signal);
  }

  async generate(request: ModelCallRequest, signal?: AbortSignal): Promise<ModelCallResult> {
    if (this.calls >= 300 || this.totalTokens >= 100_000) throw new Error("live_model_budget_exceeded");
    this.calls += 1;
    const result = await this.client.generate(request, signal);
    this.totalTokens += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    return result;
  }
}

const makeRuntime = (): { runtime: ServerRuntime; gateway: BudgetedLiveGateway } => {
  const environment = process.env;
  const vault = new EnvCredentialVault(environment);
  const gateway = new BudgetedLiveGateway(new OpenAiCompatibleClient({ credentialVault: vault }));
  const runtime = buildServer({ databasePath: ":memory:", environment, modelGateway: gateway });
  runtimes.push(runtime);
  return { runtime, gateway };
};

describe("真实模型网关（显式启用）", () => {
  it.skipIf(!runLive)("低成本检查一个文本模型", async () => {
    const { runtime } = makeRuntime();
    const response = await runtime.app.inject({ method: "POST", url: `/api/models/${encodeURIComponent(selectedModel)}/check` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: selectedModel, health: "healthy" });
  }, 120_000);

  it.skipIf(!runGame)("在调用和 Token 上限内完成六模型座位对局", async () => {
    const { runtime, gateway } = makeRuntime();
    const checked = await runtime.app.inject({ method: "POST", url: `/api/models/${encodeURIComponent(selectedModel)}/check` });
    expect(checked.json().health).toBe("healthy");
    const seats = Array.from({ length: 6 }, (_, index) => ({
      seat: index + 1, accountId: "school-account", modelId: selectedModel,
    }));
    const created = await runtime.app.inject({
      method: "POST", url: "/api/sessions",
      payload: { gameId: "live-model-game", controller: "models", seed: `live-${Date.now()}`, seats },
    });
    expect(created.statusCode).toBe(201);
    let result = created.json();
    for (let command = 0; command < 300 && result.view.outcome === null; command += 1) {
      const stepped = await runtime.app.inject({
        method: "POST", url: "/api/sessions/live-model-game/control", payload: { type: "step" },
      });
      expect(stepped.statusCode).toBe(200);
      result = stepped.json();
    }
    expect(result.view.outcome).not.toBeNull();
    expect(gateway.calls).toBeGreaterThan(0);
    expect(gateway.calls).toBeLessThanOrEqual(300);
    expect(gateway.totalTokens).toBeLessThanOrEqual(100_000);
    console.info(JSON.stringify({
      kind: "live-model-summary",
      modelId: selectedModel,
      outcome: result.view.outcome,
      calls: gateway.calls,
      totalTokens: gateway.totalTokens,
    }));
  }, 30 * 60_000);
});
