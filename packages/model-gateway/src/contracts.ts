import { z } from "zod";

export const modelAccountSchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  providerKind: z.literal("openai-compatible"),
  baseUrl: z.string().url(),
  credentialRef: z.string().min(1),
}).strict();

export const playableModelSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  capability: z.literal("text-chat"),
  enabled: z.boolean(),
}).strict();

export const modelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
}).strict();

export const modelCallRequestSchema = z.object({
  callId: z.string().min(1),
  account: modelAccountSchema,
  modelId: z.string().min(1),
  messages: z.array(modelMessageSchema).min(1),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().positive().max(4096),
  timeoutMs: z.number().int().positive().max(120_000),
}).strict();

export const modelCallResultSchema = z.object({
  callId: z.string().min(1),
  content: z.string().min(1),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().nonnegative(),
  finishReason: z.string().nullable(),
}).strict();

export type ModelAccount = z.infer<typeof modelAccountSchema>;
export type PlayableModel = z.infer<typeof playableModelSchema>;
export type ModelMessage = z.infer<typeof modelMessageSchema>;
export type ModelCallRequest = z.infer<typeof modelCallRequestSchema>;
export type ModelCallResult = z.infer<typeof modelCallResultSchema>;

export type ModelGatewayErrorCode =
  | "auth"
  | "model_not_found"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "network"
  | "invalid_response"
  | "empty"
  | "cancelled"
  | "unknown";

export class ModelGatewayError extends Error {
  constructor(
    readonly code: ModelGatewayErrorCode,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(`model_gateway_${code}`);
    this.name = "ModelGatewayError";
  }
}

export interface CredentialVault {
  get(credentialRef: string): string | null;
}
