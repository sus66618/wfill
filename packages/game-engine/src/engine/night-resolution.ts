import type { SeatId } from "@wfill/contracts";
import type { GameState, PlayerState } from "../state/game-state.js";

export interface NightResolutionResult {
  readonly state: GameState;
  readonly eliminatedSeats: readonly SeatId[];
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
  const wolfEffect = state.pendingEffects.find((effect) => effect.type === "wolf_kill");
  const eliminatedSeats = new Set<SeatId>();

  if (wolfEffect !== undefined && !antidoteUsed) {
    eliminatedSeats.add(wolfEffect.targetSeat);
  }
  if (poisonEffect !== undefined) {
    eliminatedSeats.add(poisonEffect.targetSeat);
  }

  return {
    state: {
      ...state,
      phase: "dawn",
      players: state.players.map((player) => consumeWitchResource(
        { ...player, alive: player.alive && !eliminatedSeats.has(player.seat) },
        antidoteUsed && player.roleId === "witch",
        poisonEffect !== undefined && player.roleId === "witch",
      )),
      pendingEffects: [],
    },
    eliminatedSeats: [...eliminatedSeats],
  };
};
