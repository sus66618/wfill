import type { GameCommand, SeatId } from "@wfill/contracts";
import type { GameState, PlayerState } from "../state/game-state.js";

export type LegalAction =
  | { readonly type: "submit_wolf_kill"; readonly targetSeats: readonly SeatId[] }
  | { readonly type: "inspect_player"; readonly targetSeats: readonly SeatId[] }
  | { readonly type: "use_antidote" }
  | { readonly type: "use_poison"; readonly targetSeats: readonly SeatId[] }
  | { readonly type: "pass_action" };

const hasSubmitted = (state: GameState, actorSeat: SeatId): boolean =>
  state.night.submittedActorSeats.includes(actorSeat);

const aliveTargetsExcept = (state: GameState, actorSeat: SeatId): SeatId[] =>
  state.players
    .filter((player) => player.alive && player.seat !== actorSeat)
    .map((player) => player.seat);

const legalWolfTargets = (state: GameState): SeatId[] => state.players
  .filter((player) => player.alive && player.roleId !== "werewolf")
  .map((player) => player.seat);

const witchActions = (state: GameState, actor: PlayerState): LegalAction[] => {
  const resources = actor.privateState.witchResources;
  if (resources === undefined || state.night.potionUsed) {
    return [{ type: "pass_action" }];
  }

  const actions: LegalAction[] = [];
  if (
    resources.antidoteAvailable
    && state.night.wolfTargetSeat !== undefined
    && state.night.wolfTargetSeat !== null
    && state.night.wolfTargetSeat !== actor.seat
  ) {
    actions.push({ type: "use_antidote" });
  }
  if (resources.poisonAvailable) {
    actions.push({ type: "use_poison", targetSeats: aliveTargetsExcept(state, actor.seat) });
  }
  actions.push({ type: "pass_action" });
  return actions;
};

export const getLegalActions = (state: GameState, actorSeat: SeatId): LegalAction[] => {
  const actor = state.players.find((player) => player.seat === actorSeat);
  if (actor === undefined || !actor.alive || hasSubmitted(state, actorSeat)) {
    return [];
  }

  if (
    (state.phase === "night_wolf_discussion" || state.phase === "night_wolf_final_confirmation")
    && actor.roleId === "werewolf"
  ) {
    return [
      { type: "submit_wolf_kill", targetSeats: legalWolfTargets(state) },
      { type: "pass_action" },
    ];
  }
  if (state.phase === "night_seer_action" && actor.roleId === "seer") {
    return [
      { type: "inspect_player", targetSeats: aliveTargetsExcept(state, actor.seat) },
      { type: "pass_action" },
    ];
  }
  if (state.phase === "night_witch_action" && actor.roleId === "witch") {
    return witchActions(state, actor);
  }
  return [];
};

export const legalActionForCommand = (
  state: GameState,
  command: GameCommand,
): LegalAction | undefined => getLegalActions(state, command.actorSeat)
  .find((action) => action.type === command.type);
