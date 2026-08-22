import type { DeathCause, SeatId } from "@wfill/contracts";
import type { RulesetDefinition } from "@wfill/rules-core";
import type { GameState, PendingEffect } from "../state/game-state.js";

export type DeathPhase = "night" | "day_exile" | "self_destruct";

export interface Elimination {
  readonly seat: SeatId;
  readonly cause: DeathCause;
  readonly deathPhase: DeathPhase;
  readonly dayNumber: number;
}

export interface DeathResolutionResult {
  readonly state: GameState;
  readonly eliminations: readonly Elimination[];
}

export interface LastWordsEligibilityInput {
  readonly dayNumber: number;
  readonly deathPhase: DeathPhase;
  readonly ruleset: Pick<RulesetDefinition, "selfDestruct">;
}

const causeFor = (effect: PendingEffect): DeathCause | undefined => {
  if (
    effect.type === "wolf_kill"
    || effect.type === "poison"
    || effect.type === "exile"
    || effect.type === "self_destruct"
  ) {
    return effect.type;
  }
  return undefined;
};

const phaseFor = (cause: DeathCause): DeathPhase => {
  if (cause === "exile") return "day_exile";
  if (cause === "self_destruct") return "self_destruct";
  return "night";
};

const causePriority = (cause: DeathCause): number => {
  if (cause === "poison") return 4;
  if (cause === "self_destruct") return 3;
  if (cause === "exile") return 2;
  return 1;
};

export const lastWordsEligibility = ({
  dayNumber,
  deathPhase,
  ruleset,
}: LastWordsEligibilityInput): boolean => {
  if (deathPhase === "night") return dayNumber === 1;
  if (deathPhase === "day_exile") return true;
  return ruleset.selfDestruct.enabled;
};

export const resolveDeaths = (
  state: GameState,
  effects: readonly PendingEffect[],
): DeathResolutionResult => {
  const antidoteUsed = effects.some((effect) => effect.type === "antidote");
  const causeBySeat = new Map<SeatId, DeathCause>();

  for (const effect of effects) {
    const cause = causeFor(effect);
    if (cause === undefined || !("targetSeat" in effect)) continue;
    if (cause === "wolf_kill" && antidoteUsed) continue;
    const target = state.players.find((player) => player.seat === effect.targetSeat);
    if (target === undefined || !target.alive) continue;

    const existingCause = causeBySeat.get(effect.targetSeat);
    if (existingCause === undefined || causePriority(cause) > causePriority(existingCause)) {
      causeBySeat.set(effect.targetSeat, cause);
    }
  }

  const eliminations = [...causeBySeat].map(([eliminatedSeat, cause]) => {
    const deathPhase = phaseFor(cause);
    return {
      seat: eliminatedSeat,
      cause,
      deathPhase,
      dayNumber: deathPhase === "night" ? (state.dayNumber ?? 0) + 1 : (state.dayNumber ?? 0),
    };
  });
  const eliminatedSeats = new Set(eliminations.map((elimination) => elimination.seat));

  return {
    state: {
      ...state,
      players: state.players.map((player) => eliminatedSeats.has(player.seat)
        ? { ...player, alive: false }
        : player),
    },
    eliminations,
  };
};
