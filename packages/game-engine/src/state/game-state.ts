import type { GameId, SeatId } from "@wfill/contracts";

export type GamePhase = "night_wolf_discussion";

export interface WitchResources {
  readonly antidoteAvailable: boolean;
  readonly poisonAvailable: boolean;
}

export interface PlayerPrivateState {
  readonly wolfTeammateSeats: readonly SeatId[];
  readonly witchResources?: WitchResources;
}

export interface PlayerState {
  readonly seat: SeatId;
  readonly roleId: string;
  readonly alive: boolean;
  readonly privateState: PlayerPrivateState;
}

export interface GameState {
  readonly gameId: GameId;
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly version: number;
  readonly phase: GamePhase;
  readonly players: readonly PlayerState[];
}
