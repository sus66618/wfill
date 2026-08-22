import type { SeatId } from "@wfill/contracts";
import type { PlayerController, PlayerDecision, PlayerRequest } from "./ports.js";

const targetFor = (decision: PlayerDecision): SeatId | undefined => "targetSeat" in decision
  ? decision.targetSeat
  : undefined;

const assertLegalDecision = (decision: PlayerDecision, request: PlayerRequest): void => {
  const legal = request.legalActions.find((action) => action.type === decision.type);
  if (!legal) throw new Error("scripted_action_not_legal");
  const target = targetFor(decision);
  if (legal.targetRequired && target === undefined) throw new Error("scripted_target_required");
  if (target !== undefined && !legal.targetSeats.includes(target)) throw new Error("scripted_target_not_legal");
  if (decision.type === "submit_speech") {
    const limit = legal.speechLimit ?? request.speechBudget;
    if (limit === null) throw new Error("scripted_speech_not_allowed");
    if (Array.from(decision.content).length > limit) throw new Error("scripted_speech_too_long");
  }
};

export class ScriptedPlayerController implements PlayerController {
  private cursor = 0;

  constructor(private readonly decisions: readonly PlayerDecision[]) {}

  async request(input: PlayerRequest, signal: AbortSignal): Promise<PlayerDecision> {
    if (signal.aborted) throw new Error("controller_request_cancelled");
    const decision = this.decisions[this.cursor];
    if (!decision) throw new Error("scripted_decision_exhausted");
    this.cursor += 1;
    assertLegalDecision(decision, input);
    return decision;
  }
}

export class StaticControllerRegistry {
  constructor(private readonly controllers: ReadonlyMap<SeatId, PlayerController>) {}

  get(seat: SeatId): PlayerController {
    const controller = this.controllers.get(seat);
    if (!controller) throw new Error(`controller_not_configured:${seat}`);
    return controller;
  }
}
