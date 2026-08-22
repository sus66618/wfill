import { playableModelSchema, type PlayableModel } from "./contracts.js";

const model = (id: string): PlayableModel => playableModelSchema.parse({
  id,
  displayName: id,
  capability: "text-chat",
  enabled: true,
});

export const APPROVED_PLAYABLE_MODELS: readonly PlayableModel[] = Object.freeze([
  model("Qwen3.5-9B"),
  model("Qwen3.5-35B-A3B"),
  model("Qwen3.5-122B-A10B"),
  model("DeepSeek-V3.1-W8A8"),
  model("GLM-4.6-W8A8"),
  model("MiniMax-M2.7-bf16"),
  model("Qwen3-235B-A22B"),
]);
