import { afterEach, describe, expect, it } from "vitest";
import { ModelGatewayError, type ModelAccount, type ModelCallResult } from "@wfill/model-gateway";
import { buildServer, type ServerRuntime } from "../src/app.js";
import type { ModelHealthGateway } from "../src/runtime/model-runtime.js";

const runtimes: ServerRuntime[] = [];
afterEach(async () => Promise.all(runtimes.splice(0).map((runtime) => runtime.close())));

class FakeHealthGateway implements ModelHealthGateway {
  readonly calls: string[] = [];
  constructor(private readonly failures: Readonly<Record<string, ModelGatewayError>> = {}) {}
  async checkModel(_account: ModelAccount, modelId: string): Promise<ModelCallResult> {
    this.calls.push(modelId);
    const failure = this.failures[modelId];
    if (failure) throw failure;
    return {
      callId: `health:${modelId}`, content: "OK", inputTokens: 3, outputTokens: 1,
      latencyMs: 12, finishReason: "stop",
    };
  }
}

const appWith = (environment: Record<string, string | undefined>, gateway = new FakeHealthGateway()) => {
  const runtime = buildServer({ databasePath: ":memory:", environment, modelGateway: gateway });
  runtimes.push(runtime);
  return { app: runtime.app, gateway };
};

describe("模型目录和健康检查 API", () => {
  it("只暴露七个安全模型和密钥配置布尔值", async () => {
    const { app } = appWith({
      WFILL_SCHOOL_API_BASE_URL: "http://aigw.dlut.edu.cn/v1",
      WFILL_SCHOOL_API_KEY: "school-secret",
    });
    const response = await app.inject({ method: "GET", url: "/api/models" });
    expect(response.statusCode).toBe(200);
    expect(response.json().configured).toBe(true);
    expect(response.json().models).toHaveLength(7);
    expect(response.json().models.map((model: { id: string }) => model.id)).toContain("Qwen3.5-9B");
    expect(JSON.stringify(response.json())).not.toMatch(/school-secret|credentialRef|authorization|apiKey/i);
  });

  it("缺少密钥时服务仍健康但模型不可检查", async () => {
    const { app } = appWith({ WFILL_SCHOOL_API_BASE_URL: "http://aigw.dlut.edu.cn/v1" });
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const catalog = await app.inject({ method: "GET", url: "/api/models" });
    expect(catalog.json().configured).toBe(false);
    const check = await app.inject({ method: "POST", url: "/api/models/Qwen3.5-9B/check" });
    expect(check.statusCode).toBe(409);
    expect(check.json()).toEqual({ error: "credential_not_configured" });
  });

  it("保存健康结果并归一化供应端错误", async () => {
    const gateway = new FakeHealthGateway({
      "GLM-4.6-W8A8": new ModelGatewayError("rate_limit", true, 429),
    });
    const { app } = appWith({
      WFILL_SCHOOL_API_BASE_URL: "http://aigw.dlut.edu.cn/v1",
      WFILL_SCHOOL_API_KEY: "school-secret",
    }, gateway);
    const healthy = await app.inject({ method: "POST", url: "/api/models/Qwen3.5-9B/check" });
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json()).toMatchObject({ id: "Qwen3.5-9B", health: "healthy", errorCode: null });
    const unhealthy = await app.inject({ method: "POST", url: "/api/models/GLM-4.6-W8A8/check" });
    expect(unhealthy.statusCode).toBe(200);
    expect(unhealthy.json()).toMatchObject({ id: "GLM-4.6-W8A8", health: "unhealthy", errorCode: "rate_limit" });
    expect(JSON.stringify(unhealthy.json())).not.toContain("school-secret");
  });

  it("全量检查覆盖目录且拒绝未知模型", async () => {
    const { app, gateway } = appWith({
      WFILL_SCHOOL_API_BASE_URL: "http://aigw.dlut.edu.cn/v1",
      WFILL_SCHOOL_API_KEY: "school-secret",
    });
    const all = await app.inject({ method: "POST", url: "/api/models/check-all" });
    expect(all.statusCode).toBe(200);
    expect(all.json().models).toHaveLength(7);
    expect(gateway.calls).toHaveLength(7);
    expect((await app.inject({ method: "POST", url: "/api/models/not-a-model/check" })).statusCode).toBe(404);
  });
});
