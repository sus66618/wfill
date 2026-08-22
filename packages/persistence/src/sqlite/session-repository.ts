import type { DatabaseSync } from "node:sqlite";
import {
  GameEventSchema,
  sessionUpdateSchema,
  type GameEvent,
  type GameId,
  type SessionUpdate,
} from "@wfill/contracts";
import type { SessionRepository, SessionTransition, StoredSession } from "@wfill/application";
import { assertGameState, type GameState } from "@wfill/game-engine";

export class PersistenceConflictError extends Error {
  constructor() {
    super("persistence_version_conflict");
    this.name = "PersistenceConflictError";
  }
}

const parseState = (json: string): GameState => {
  const state = JSON.parse(json) as GameState;
  assertGameState(state);
  return state;
};

const parseEvent = (json: string): GameEvent => GameEventSchema.parse(JSON.parse(json));

const nextSequence = (database: DatabaseSync, table: "player_events" | "audit_events", gameId: GameId): number => {
  const row = database.prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM ${table} WHERE game_id = ?`)
    .get(gameId);
  return Number(row?.sequence ?? 0) + 1;
};

const insertEvents = (
  database: DatabaseSync,
  table: "player_events" | "audit_events",
  gameId: GameId,
  events: readonly GameEvent[],
): void => {
  let sequence = nextSequence(database, table, gameId);
  const statement = database.prepare(`
    INSERT INTO ${table}(game_id, sequence, event_id, version, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const event of events) {
    const parsed = GameEventSchema.parse(event);
    if (parsed.gameId !== gameId) throw new Error("persistence_event_game_mismatch");
    statement.run(gameId, sequence, parsed.eventId, parsed.version, JSON.stringify(parsed));
    sequence += 1;
  }
};

const audienceKeyFor = (update: SessionUpdate): string => {
  if (update.type !== "view_snapshot") return "shared";
  if (update.view.mode.kind === "seat") return `seat:${update.view.mode.seat}`;
  return update.view.mode.kind;
};

const insertUpdates = (database: DatabaseSync, gameId: GameId, updates: readonly SessionUpdate[]): void => {
  const statement = database.prepare(`
    INSERT INTO session_updates(game_id, sequence, audience_key, payload_json)
    VALUES (?, ?, ?, ?)
  `);
  for (const update of updates) {
    const parsed = sessionUpdateSchema.parse(update);
    if (parsed.gameId !== gameId) throw new Error("persistence_update_game_mismatch");
    statement.run(gameId, parsed.sequence, audienceKeyFor(parsed), JSON.stringify(parsed));
  }
};

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(session: StoredSession): void {
    assertGameState(session.initialState);
    assertGameState(session.state);
    if (session.initialState.gameId !== session.state.gameId) throw new Error("persistence_initial_game_mismatch");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO sessions(
          game_id, ruleset_id, ruleset_version, current_version,
          initial_state_json, state_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.state.gameId,
        session.state.rulesetId,
        session.state.rulesetVersion,
        session.state.version,
        JSON.stringify(session.initialState),
        JSON.stringify(session.state),
        session.state.outcome === "ongoing" ? "active" : "finished",
      );
      insertEvents(this.database, "player_events", session.state.gameId, session.playerEvents);
      insertEvents(this.database, "audit_events", session.state.gameId, session.auditEvents);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  appendTransition(transition: SessionTransition): void {
    assertGameState(transition.state);
    if (transition.state.gameId !== transition.gameId) throw new Error("persistence_state_game_mismatch");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.database.prepare("SELECT current_version FROM sessions WHERE game_id = ?")
        .get(transition.gameId);
      if (!current) throw new Error("persistence_session_not_found");
      if (Number(current.current_version) !== transition.expectedPreviousVersion) {
        throw new PersistenceConflictError();
      }
      insertEvents(this.database, "player_events", transition.gameId, transition.playerEvents);
      insertEvents(this.database, "audit_events", transition.gameId, transition.auditEvents);
      insertUpdates(this.database, transition.gameId, transition.updates);
      this.database.prepare(`
        UPDATE sessions SET current_version = ?, state_json = ?, status = ? WHERE game_id = ?
      `).run(
        transition.state.version,
        JSON.stringify(transition.state),
        transition.state.outcome === "ongoing" ? "active" : "finished",
        transition.gameId,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  load(gameId: GameId): StoredSession | null {
    const session = this.database.prepare(`
      SELECT initial_state_json, state_json FROM sessions WHERE game_id = ?
    `).get(gameId);
    if (!session) return null;
    const playerRows = this.database.prepare(`
      SELECT payload_json FROM player_events WHERE game_id = ? ORDER BY sequence
    `).all(gameId);
    const auditRows = this.database.prepare(`
      SELECT payload_json FROM audit_events WHERE game_id = ? ORDER BY sequence
    `).all(gameId);
    return {
      initialState: parseState(String(session.initial_state_json)),
      state: parseState(String(session.state_json)),
      playerEvents: playerRows.map((row) => parseEvent(String(row.payload_json))),
      auditEvents: auditRows.map((row) => parseEvent(String(row.payload_json))),
    };
  }

  list(): readonly StoredSession[] {
    const rows = this.database.prepare("SELECT game_id FROM sessions ORDER BY game_id").all();
    return rows.map((row) => this.load(String(row.game_id) as GameId)).filter((session): session is StoredSession => session !== null);
  }

  close(): void {
    this.database.close();
  }
}

