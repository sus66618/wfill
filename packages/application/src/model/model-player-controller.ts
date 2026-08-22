import type { ModelAccount, ModelCallRequest, ModelCallResult } from "@wfill/model-gateway";
import type { PlayerController, PlayerDecision, PlayerRequest } from "../ports.js";
import { buildModelPrompt } from "./prompt-builder.js";
import { executeWithModelPolicy, type ModelAttemptKind } from "./failure-policy.js";

export interface ModelTextGateway {
  generate(request: ModelCallRequest, signal?: AbortSignal): Promise<ModelCallResult>;
}

export interface ModelPlayerControllerOptions {
  readonly account: ModelAccount;
  readonly modelId: string;
  readonly gateway: ModelTextGateway;
  readonly timeoutMs?: number;
}

export class ModelPlayerController implements PlayerController {
  constructor(private readonly options: ModelPlayerControllerOptions) {}

  async request(input: PlayerRequest, signal: AbortSignal): Promise<PlayerDecision> {
    if (signal.aborted) throw new Error("controller_request_cancelled");
    const prompt = buildModelPrompt(input);
    let attempt = 0;
    const outcome = await executeWithModelPolicy({
      request: input,
      call: async (kind: ModelAttemptKind) => {
        attempt += 1;
        const repairInstruction = kind === "format_repair"
          ? { role: "user" as const, content: "上次输出格式无效。只修正格式，严格输出一个符合合法动作协议的 JSON 对象。" }
          : kind === "speech_compression"
            ? { role: "user" as const, content: `将上次发言压缩到${input.speechBudget ?? 220}个汉字以内，只输出压缩后的正文。` }
            : null;
        const result = await this.options.gateway.generate({
          callId: `${input.gameId}:seat:${input.actorSeat}:version:${input.expectedVersion}:attempt:${attempt}`,
          account: this.options.account,
          modelId: this.options.modelId,
          messages: repairInstruction ? [...prompt.messages, repairInstruction] : [...prompt.messages],
          temperature: prompt.responseKind === "speech" ? 0.7 : 0.2,
          maxOutputTokens: prompt.maxOutputTokens,
          timeoutMs: this.options.timeoutMs ?? 30_000,
        }, signal);
        return result.content;
      },
    });
    return outcome.decision;
  }
}
