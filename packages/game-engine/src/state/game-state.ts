import type { CommandId, GameId, SeatId } from "@wfill/contracts";
import type { SpeechLimits } from "@wfill/rules-core";

export type GamePhase =
  | "night_wolf_discussion"
  | "night_wolf_final_confirmation"
  | "night_seer_action"
  | "night_witch_action"
  | "dawn"
  | "day_speech"
  | "day_vote"
  | "day_pk_speech"
  | "day_pk_vote"
  | "day_exile_last_words"
  | "settlement";

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

export interface SpeechState {
  readonly kind: "ordinary" | "pk" | "last_words";
  readonly eligibleSpeakerSeats: readonly SeatId[];
  readonly speakingOrder: readonly SeatId[];
  readonly submittedSpeakerSeats: readonly SeatId[];
  readonly limit: number;
}

export interface VoteBallot {
  readonly actorSeat: SeatId;
  readonly targetSeat: SeatId | null;
}

export interface VoteRoundState {
  readonly kind: "exile" | "pk";
  readonly roundVersion: number;
  readonly eligibleVoterSeats: readonly SeatId[];
  readonly candidateSeats: readonly SeatId[];
  readonly pendingBallots: readonly VoteBallot[];
}

export interface VoteTallyEntry {
  readonly targetSeat: SeatId;
  readonly votes: number;
}

export interface PublicVoteResult {
  readonly roundKind: "exile" | "pk";
  readonly roundVersion: number;
  readonly ballots: readonly VoteBallot[];
  readonly tally: readonly VoteTallyEntry[];
  readonly exiledSeat?: SeatId;
}

export interface GameState {
  readonly gameId: GameId;
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly seed?: string;
  readonly speechLimits?: SpeechLimits;
  readonly dayNumber?: number;
  readonly lastNightEliminatedSeats?: readonly SeatId[];
  readonly version: number;
  readonly phase: GamePhase;
  readonly players: readonly PlayerState[];
  readonly pendingEffects: readonly PendingEffect[];
  readonly processedCommandIds: readonly CommandId[];
  readonly night: NightState;
  readonly speech?: SpeechState | null;
  readonly vote?: VoteRoundState | null;
  readonly publicVoteResult?: PublicVoteResult | null;
  readonly pendingExileSeat?: SeatId | null;
}
