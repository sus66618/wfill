import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  EnvCredentialVault,
  ModelGatewayError,
  OpenAiCompatibleClient,
  type ModelAccount,
} from "../src/index.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
  server.closeAllConnections();
  server.close(() => resolve());
}))));

const startGateway = async (handler: (request: IncomingMessage, response: ServerResponse) => void) => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_server_address_missing");
  return `http://127.0.0.1:${address.port}/v1`;
};

const account = (baseUrl: string): ModelAccount => ({
  accountId: "school-account",
  displayName: "学校网关",
  providerKind: "openai-compatible",
  baseUrl,
  credentialRef: "school-key",
});

const client = () => new OpenAiCompatibleClient({
  credentialVault: new EnvCredentialVault({ WFILL_SCHOOL_API_KEY: "school-secret" }),
});

describe("OpenAI-Compatible HTTP 客户端", () => {
  it("发送标准聊天请求并归一化文本和 Token", async () => {
    let captured = "";
    const baseUrl = await startGateway((request, response) => {
      expect(request.url).toBe("/v1/chat/completions");
      expect(request.method).toBe("POST");
      expect(request.headers.authorization).toBe("Bearer school-secret");
      request.setEncoding("utf8");
      request.on("data", (chunk) => { captured += chunk; });
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          choices: [{ message: { content: "最终发言" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 21, completion_tokens: 7 },
        }));
      });
    });
    const result = await client().generate({
      callId: "call-1",
      account: account(baseUrl),
      modelId: "Qwen3.5-9B",
      messages: [{ role: "system", content: "只给最终答案" }],
      temperature: 0.4,
      maxOutputTokens: 128,
      timeoutMs: 1_000,
    });
    expect(JSON.parse(captured)).toMatchObject({
      model: "Qwen3.5-9B",
      temperature: 0.4,
      max_tokens: 128,
    });
    expect(result).toMatchObject({ content: "最终发言", inputTokens: 21, outputTokens: 7, finishReason: "stop" });
  });

  it("读取模型目录", async () => {
    const baseUrl = await startGateway((request, response) => {
      expect(request.url).toBe("/v1/models");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "Qwen3.5-9B" }, { id: "GLM-4.6-W8A8" }] }));
    });
    await expect(client().listModels(account(baseUrl))).resolves.toEqual(["Qwen3.5-9B", "GLM-4.6-W8A8"]);
  });

  it.each([
    [401, "auth", false],
    [404, "model_not_found", false],
    [402, "quota", false],
    [403, "quota", false],
    [429, "rate_limit", true],
    [500, "network", true],
  ] as const)("将 HTTP %s 归一化为 %s", async (status, code, retryable) => {
    const baseUrl = await startGateway((_request, response) => {
      response.statusCode = status;
      response.end("school-secret provider-body");
    });
    const promise = client().generate({
      callId: `status-${status}`,
      account: account(baseUrl),
      modelId: "Qwen3.5-9B",
      messages: [{ role: "user", content: "test" }],
      temperature: 0,
      maxOutputTokens: 8,
      timeoutMs: 500,
    });
    const error = await promise.catch((caught) => caught);
    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code, retryable, status });
    expect(String(error)).not.toContain("school-secret");
    expect(String(error)).not.toContain("provider-body");
  });

  it("区分超时、外部取消、空内容和畸形响应", async () => {
    const slowUrl = await startGateway(() => {});
    await expect(client().generate({
      callId: "timeout-call", account: account(slowUrl), modelId: "Qwen3.5-9B",
      messages: [{ role: "user", content: "test" }], temperature: 0, maxOutputTokens: 8, timeoutMs: 20,
    })).rejects.toMatchObject({ code: "timeout" });

    const cancelClient = client();
    const cancelled = cancelClient.generate({
      callId: "cancel-call", account: account(slowUrl), modelId: "Qwen3.5-9B",
      messages: [{ role: "user", content: "test" }], temperature: 0, maxOutputTokens: 8, timeoutMs: 1_000,
    });
    cancelClient.cancel("cancel-call");
    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });

    const emptyUrl = await startGateway((_request, response) => response.end(JSON.stringify({ choices: [{ message: { content: "  " } }] })));
    await expect(client().checkModel(account(emptyUrl), "Qwen3.5-9B")).rejects.toMatchObject({ code: "empty" });
    const malformedUrl = await startGateway((_request, response) => response.end("not-json"));
    await expect(client().checkModel(account(malformedUrl), "Qwen3.5-9B")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("缺失凭据时不发起网络请求", async () => {
    const missing = new OpenAiCompatibleClient({ credentialVault: new EnvCredentialVault({}) });
    await expect(missing.listModels(account("http://127.0.0.1:1/v1"))).rejects.toMatchObject({ code: "auth" });
  });
});
