import { z } from "zod";
import type { SeatId } from "@wfill/contracts";
import type { PlayerDecision, PlayerRequest } from "../ports.js";

const actionSchema = z.object({
  action: z.enum([
    "submit_vote",
    "submit_wolf_kill",
    "inspect_player",
    "use_antidote",
    "use_poison",
    "self_destruct",
    "pass_action",
  ]),
  targetSeat: z.number().int().min(1).max(24).optional(),
}).strict();

const decisionFor = (action: z.infer<typeof actionSchema>): PlayerDecision => {
  switch (action.action) {
    case "submit_vote": return { type: "submit_vote", targetSeat: action.targetSeat as SeatId };
    case "submit_wolf_kill": return { type: "submit_wolf_kill", targetSeat: action.targetSeat as SeatId };
    case "inspect_player": return { type: "inspect_player", targetSeat: action.targetSeat as SeatId };
    case "use_poison": return { type: "use_poison", targetSeat: action.targetSeat as SeatId };
    case "use_antidote": return { type: "use_antidote" };
    case "self_destruct": return { type: "self_destruct" };
    case "pass_action": return { type: "pass_action" };
    default: throw new Error("model_action_schema_invalid");
  }
};

export const parseModelDecision = (content: string, request: PlayerRequest): PlayerDecision => {
  const speech = request.legalActions.find((action) => action.type === "submit_speech");
  const trimmed = content.trim();
  if (speech) {
    if (!trimmed) throw new Error("model_speech_empty");
    const limit = request.speechBudget ?? speech.speechLimit;
    if (limit === null) throw new Error("model_speech_not_allowed");
    if (Array.from(trimmed).length > limit) throw new Error("model_speech_too_long");
    return { type: "submit_speech", content: trimmed };
  }

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) throw new Error("model_action_not_single_json");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new Error("model_action_not_single_json");
  }
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) throw new Error("model_action_schema_invalid");
  const legal = request.legalActions.find((action) => action.type === parsed.data.action);
  if (!legal) throw new Error("model_action_not_legal");
  if (legal.targetRequired && parsed.data.targetSeat === undefined) throw new Error("model_action_target_required");
  if (parsed.data.targetSeat !== undefined && !legal.targetSeats.includes(parsed.data.targetSeat as SeatId)) {
    throw new Error("model_action_target_illegal");
  }
  if (!legal.targetRequired && parsed.data.targetSeat !== undefined) throw new Error("model_action_target_illegal");
  return decisionFor(parsed.data);
};
