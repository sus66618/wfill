import { z } from "zod";
import {
  ModelGatewayError,
  modelCallRequestSchema,
  modelCallResultSchema,
  type CredentialVault,
  type ModelAccount,
  type ModelCallRequest,
  type ModelCallResult,
} from "./contracts.js";

const chatResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() }).passthrough(),
    finish_reason: z.string().nullable().optional(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();

const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) }).passthrough()),
}).passthrough();

const endpoint = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/+$/, "")}${path}`;

const errorForStatus = (status: number): ModelGatewayError => {
  if (status === 401) return new ModelGatewayError("auth", false, status);
  if (status === 404) return new ModelGatewayError("model_not_found", false, status);
  if (status === 402 || status === 403) return new ModelGatewayError("quota", false, status);
  if (status === 429) return new ModelGatewayError("rate_limit", true, status);
  if (status >= 500) return new ModelGatewayError("network", true, status);
  return new ModelGatewayError("unknown", false, status);
};

const safeJson = (text: string): unknown => {
  if (Buffer.byteLength(text, "utf8") > 1_048_576) throw new ModelGatewayError("invalid_response", false);
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelGatewayError("invalid_response", false);
  }
};

export interface OpenAiCompatibleClientOptions {
  readonly credentialVault: CredentialVault;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
}

export class OpenAiCompatibleClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly activeCalls = new Map<string, AbortController>();

  constructor(private readonly options: OpenAiCompatibleClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? (() => performance.now());
  }

  async listModels(account: ModelAccount, timeoutMs = 10_000): Promise<string[]> {
    const credential = this.requireCredential(account);
    const response = await this.fetchJson(
      endpoint(account.baseUrl, "/models"),
      { method: "GET", headers: { authorization: `Bearer ${credential}` } },
      timeoutMs,
    );
    const parsed = modelsResponseSchema.safeParse(response);
    if (!parsed.success) throw new ModelGatewayError("invalid_response", false);
    return parsed.data.data.map((model) => model.id);
  }

  async checkModel(account: ModelAccount, modelId: string, signal?: AbortSignal): Promise<ModelCallResult> {
    return this.generate({
      callId: `health:${account.accountId}:${modelId}`,
      account,
      modelId,
      messages: [{ role: "user", content: "只回复 OK" }],
      temperature: 0,
      maxOutputTokens: 8,
      timeoutMs: 10_000,
    }, signal);
  }

  async generate(input: ModelCallRequest, externalSignal?: AbortSignal): Promise<ModelCallResult> {
    const request = modelCallRequestSchema.parse(input);
    const credential = this.requireCredential(request.account);
    const activeController = new AbortController();
    this.activeCalls.set(request.callId, activeController);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), request.timeoutMs);
    const signals = [activeController.signal, timeoutController.signal];
    if (externalSignal) signals.push(externalSignal);
    const startedAt = this.now();
    try {
      const response = await this.fetchImplementation(endpoint(request.account.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.modelId,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
        }),
        signal: AbortSignal.any(signals),
      });
      if (!response.ok) throw errorForStatus(response.status);
      const text = await response.text();
      const parsed = chatResponseSchema.safeParse(safeJson(text));
      if (!parsed.success) throw new ModelGatewayError("invalid_response", false);
      const content = parsed.data.choices[0]!.message.content?.trim();
      if (!content) throw new ModelGatewayError("empty", false);
      return modelCallResultSchema.parse({
        callId: request.callId,
        content,
        inputTokens: parsed.data.usage?.prompt_tokens ?? null,
        outputTokens: parsed.data.usage?.completion_tokens ?? null,
        latencyMs: this.now() - startedAt,
        finishReason: parsed.data.choices[0]!.finish_reason ?? null,
      });
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      if (timeoutController.signal.aborted) throw new ModelGatewayError("timeout", true);
      if (activeController.signal.aborted || externalSignal?.aborted) throw new ModelGatewayError("cancelled", false);
      throw new ModelGatewayError("network", true);
    } finally {
      clearTimeout(timer);
      if (this.activeCalls.get(request.callId) === activeController) this.activeCalls.delete(request.callId);
    }
  }

  cancel(callId: string): void {
    this.activeCalls.get(callId)?.abort();
  }

  private requireCredential(account: ModelAccount): string {
    const credential = this.options.credentialVault.get(account.credentialRef);
    if (!credential) throw new ModelGatewayError("auth", false);
    return credential;
  }

  private async fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    try {
      const response = await this.fetchImplementation(url, { ...init, signal: timeoutController.signal });
      if (!response.ok) throw errorForStatus(response.status);
      return safeJson(await response.text());
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      if (timeoutController.signal.aborted) throw new ModelGatewayError("timeout", true);
      throw new ModelGatewayError("network", true);
    } finally {
      clearTimeout(timer);
    }
  }
}
