import type { GameEvent, GameId, GameView, SeatId, SessionUpdate, SpectatorMode } from "@wfill/contracts";
import type { GamePhase, GameState, LegalAction } from "@wfill/game-engine";

export interface StoredSession {
  readonly state: GameState;
  readonly initialState: GameState;
  readonly playerEvents: readonly GameEvent[];
  readonly auditEvents: readonly GameEvent[];
}

export interface SessionTransition {
  readonly gameId: GameId;
  readonly expectedPreviousVersion: number;
  readonly state: GameState;
  readonly playerEvents: readonly GameEvent[];
  readonly auditEvents: readonly GameEvent[];
  readonly updates: readonly SessionUpdate[];
}

export interface SessionRepository {
  create(session: StoredSession): void;
  appendTransition(transition: SessionTransition): void;
  load(gameId: GameId): StoredSession | null;
  list(): readonly StoredSession[];
  close(): void;
}

export type GameUpdateListener = (update: SessionUpdate) => void;

export interface GameUpdatePublisher {
  publish(gameId: GameId, updates: readonly SessionUpdate[]): void;
  subscribe(gameId: GameId, mode: SpectatorMode, listener: GameUpdateListener): () => void;
}

export interface ProjectedSession {
  readonly view: GameView;
  readonly updates: readonly SessionUpdate[];
}

export type PlayerDecision =
  | { readonly type: "submit_speech"; readonly content: string }
  | { readonly type: "submit_vote"; readonly targetSeat: SeatId }
  | { readonly type: "submit_wolf_kill"; readonly targetSeat: SeatId }
  | { readonly type: "inspect_player"; readonly targetSeat: SeatId }
  | { readonly type: "use_antidote" }
  | { readonly type: "use_poison"; readonly targetSeat: SeatId }
  | { readonly type: "self_destruct" }
  | { readonly type: "pass_action" };

export interface PlayerRequest {
  readonly gameId: GameId;
  readonly actorSeat: SeatId;
  readonly expectedVersion: number;
  readonly taskKind: GamePhase;
  readonly view: GameView;
  readonly legalActions: readonly LegalAction[];
  readonly speechBudget: number | null;
}

export interface PlayerController {
  request(input: PlayerRequest, signal: AbortSignal): Promise<PlayerDecision>;
}

export interface ControllerRegistry {
  get(seat: SeatId): PlayerController;
}
