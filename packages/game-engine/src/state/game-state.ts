import type { CommandId, GameId, SeatId } from "@wfill/contracts";

export type GamePhase =
  | "night_wolf_discussion"
  | "night_wolf_final_confirmation"
  | "night_seer_action"
  | "night_witch_action"
  | "dawn";

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

export type PendingEffect =
  | { readonly type: "wolf_kill"; readonly targetSeat: SeatId }
  | { readonly type: "inspection"; readonly actorSeat: SeatId; readonly targetSeat: SeatId }
  | { readonly type: "antidote"; readonly actorSeat: SeatId }
  | { readonly type: "poison"; readonly actorSeat: SeatId; readonly targetSeat: SeatId };

export interface WolfSubmission {
  readonly actorSeat: SeatId;
  readonly targetSeat: SeatId | null;
}

export interface NightState {
  readonly wolfConfirmationRound: 1 | 2;
  readonly wolfSubmissions: readonly WolfSubmission[];
  readonly submittedActorSeats: readonly SeatId[];
  readonly wolfTargetSeat?: SeatId | null;
  readonly potionUsed: boolean;
}

export interface GameState {
  readonly gameId: GameId;
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly version: number;
  readonly phase: GamePhase;
  readonly players: readonly PlayerState[];
  readonly pendingEffects: readonly PendingEffect[];
  readonly processedCommandIds: readonly CommandId[];
  readonly night: NightState;
}
