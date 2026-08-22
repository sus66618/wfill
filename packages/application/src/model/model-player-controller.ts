import type { ModelAccount, ModelCallRequest, ModelCallResult } from "@wfill/model-gateway";
import type { PlayerController, PlayerDecision, PlayerRequest } from "../ports.js";
import { parseModelDecision } from "./decision-parser.js";
import { buildModelPrompt } from "./prompt-builder.js";

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
    const result = await this.options.gateway.generate({
      callId: `${input.gameId}:seat:${input.actorSeat}:version:${input.expectedVersion}`,
      account: this.options.account,
      modelId: this.options.modelId,
      messages: [...prompt.messages],
      temperature: prompt.responseKind === "speech" ? 0.7 : 0.2,
      maxOutputTokens: prompt.maxOutputTokens,
      timeoutMs: this.options.timeoutMs ?? 30_000,
    }, signal);
    return parseModelDecision(result.content, input);
  }
}
