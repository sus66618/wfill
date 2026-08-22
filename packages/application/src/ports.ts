import type { GameEvent, GameId, GameView, SessionUpdate, SpectatorMode } from "@wfill/contracts";
import type { GameState } from "@wfill/game-engine";

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

