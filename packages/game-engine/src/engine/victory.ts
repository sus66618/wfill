import type { GameState } from "../state/game-state.js";

export type VictoryResult =
  | { readonly status: "ongoing" }
  | { readonly status: "good_win"; readonly winner: "good" }
  | { readonly status: "wolf_win"; readonly winner: "werewolf" };

export const evaluateVictory = (state: GameState): VictoryResult => {
  const livingPlayers = state.players.filter((player) => player.alive);
  if (!livingPlayers.some((player) => player.roleId === "werewolf")) {
    return { status: "good_win", winner: "good" };
  }
  if (!livingPlayers.some((player) => player.roleId !== "werewolf")) {
    return { status: "wolf_win", winner: "werewolf" };
  }
  return { status: "ongoing" };
};
