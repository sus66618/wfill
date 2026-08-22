import type { SeatId } from "@wfill/contracts";
import type { GameState, PlayerState } from "../state/game-state.js";
import { resolveDeaths, type Elimination } from "./death-resolution.js";

export interface NightResolutionResult {
  readonly state: GameState;
  readonly eliminatedSeats: readonly SeatId[];
  readonly eliminations: readonly Elimination[];
}

const consumeWitchResource = (
  player: PlayerState,
  antidoteUsed: boolean,
  poisonUsed: boolean,
): PlayerState => {
  const resources = player.privateState.witchResources;
  if (resources === undefined) {
    return player;
  }
  return {
    ...player,
    privateState: {
      ...player.privateState,
      witchResources: {
        antidoteAvailable: resources.antidoteAvailable && !antidoteUsed,
        poisonAvailable: resources.poisonAvailable && !poisonUsed,
      },
    },
  };
};

export const resolveNight = (state: GameState): NightResolutionResult => {
  const antidoteUsed = state.pendingEffects.some((effect) => effect.type === "antidote");
  const poisonEffect = state.pendingEffects.find((effect) => effect.type === "poison");
  const deathResolution = resolveDeaths(state, state.pendingEffects);
  const eliminatedSeats = deathResolution.eliminations.map((elimination) => elimination.seat);

  return {
    state: {
      ...deathResolution.state,
      phase: "dawn",
      players: deathResolution.state.players.map((player) => consumeWitchResource(
        player,
        antidoteUsed && player.roleId === "witch",
        poisonEffect !== undefined && player.roleId === "witch",
      )),
      pendingEffects: [],
    },
    eliminatedSeats,
    eliminations: deathResolution.eliminations,
  };
};
