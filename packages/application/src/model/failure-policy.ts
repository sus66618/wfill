import { ModelGatewayError } from "@wfill/model-gateway";
import type { PlayerDecision, PlayerRequest } from "../ports.js";
import { parseModelDecision } from "./decision-parser.js";

export type ModelAttemptKind = "initial" | "format_repair" | "speech_compression";

export interface ModelPolicyOutcome {
  readonly decision: PlayerDecision;
  readonly attempts: number;
  readonly degraded: boolean;
  readonly reason: string | null;
}

export interface ModelPolicyInput {
  readonly request: PlayerRequest;
  readonly call: (kind: ModelAttemptKind) => Promise<string>;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

export class ModelTurnRequiredError extends Error {
  constructor() {
    super("model_turn_requires_manual_recovery");
    this.name = "ModelTurnRequiredError";
  }
}

const defaultDelay = async (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const truncateSpeech = (content: string, limit: number): string => {
  const characters = Array.from(content.trim());
  if (characters.length <= limit) return characters.join("");
  const prefix = characters.slice(0, limit).join("");
  const boundaries = ["。", "！", "？", "；"];
  let lastBoundary = -1;
  for (const boundary of boundaries) lastBoundary = Math.max(lastBoundary, prefix.lastIndexOf(boundary));
  return lastBoundary >= 0 ? prefix.slice(0, lastBoundary + 1) : prefix;
};

const fallbackFor = (request: PlayerRequest, reason: string, attempts: number): ModelPolicyOutcome => {
  if (request.legalActions.some((action) => action.type === "submit_speech")) {
    return { decision: { type: "submit_speech", content: "过。" }, attempts, degraded: true, reason };
  }
  if (request.legalActions.some((action) => action.type === "pass_action")) {
    return { decision: { type: "pass_action" }, attempts, degraded: true, reason };
  }
  throw new ModelTurnRequiredError();
};

export const executeWithModelPolicy = async (input: ModelPolicyInput): Promise<ModelPolicyOutcome> => {
  const delay = input.delay ?? defaultDelay;
  let attempts = 0;
  const invoke = async (kind: ModelAttemptKind): Promise<string> => {
    for (let retry = 0; ; retry += 1) {
      attempts += 1;
      try {
        return await input.call(kind);
      } catch (error) {
        if (!(error instanceof ModelGatewayError) || !error.retryable || retry >= 2) throw error;
        await delay(100 * (2 ** retry));
      }
    }
  };

  let initial: string;
  try {
    initial = await invoke("initial");
  } catch (error) {
    return fallbackFor(input.request, error instanceof ModelGatewayError ? error.code : "call_failed", attempts);
  }

  try {
    return { decision: parseModelDecision(initial, input.request), attempts, degraded: false, reason: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid_decision";
    const speechLimit = input.request.speechBudget
      ?? input.request.legalActions.find((action) => action.type === "submit_speech")?.speechLimit
      ?? null;
    if (reason === "model_speech_too_long" && speechLimit !== null) {
      let compressed = initial;
      try {
        compressed = await invoke("speech_compression");
        return {
          decision: parseModelDecision(compressed, input.request),
          attempts,
          degraded: true,
          reason: "speech_compressed",
        };
      } catch {
        const truncated = truncateSpeech(compressed, speechLimit);
        try {
          return {
            decision: parseModelDecision(truncated, input.request),
            attempts,
            degraded: true,
            reason: "speech_truncated",
          };
        } catch {
          return fallbackFor(input.request, "speech_invalid", attempts);
        }
      }
    }

    if (reason.startsWith("model_action_")) {
      try {
        const repaired = await invoke("format_repair");
        return {
          decision: parseModelDecision(repaired, input.request),
          attempts,
          degraded: true,
          reason: "format_repaired",
        };
      } catch {
        return fallbackFor(input.request, "action_invalid", attempts);
      }
    }
    return fallbackFor(input.request, reason, attempts);
  }
};
