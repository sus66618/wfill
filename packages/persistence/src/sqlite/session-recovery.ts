import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { GameEventSchema, type GameEvent, type GameId } from "@wfill/contracts";
import { assertGameState, restoreFromAuditJournal, type GameState } from "@wfill/game-engine";

export interface RecoveredSession {
  readonly state: GameState;
  readonly initialState: GameState;
  readonly playerEvents: readonly GameEvent[];
  readonly auditEvents: readonly GameEvent[];
}
const parseState = (value: unknown): GameState => {
  const state = JSON.parse(String(value)) as GameState;
  assertGameState(state);
  return state;
};

const parseEvents = (rows: readonly Record<string, unknown>[]): GameEvent[] => rows.map((row) =>
  GameEventSchema.parse(JSON.parse(String(row.payload_json))),
);

export class SessionRecoveryError extends Error {
  constructor(reason: string) {
    super(`session_recovery_${reason}`);
    this.name = "SessionRecoveryError";
  }
}

export class SqliteSessionRecoveryService {
  constructor(private readonly database: DatabaseSync) {}

  recover(gameId: GameId): RecoveredSession {
    try {
      const session = this.database.prepare(`
        SELECT initial_state_json, state_json, ruleset_id, ruleset_version
        FROM sessions WHERE game_id = ?
      `).get(gameId);
      if (!session) throw new SessionRecoveryError("not_found");
      const initialState = parseState(session.initial_state_json);
      const storedState = parseState(session.state_json);
      if (
        initialState.gameId !== gameId
        || initialState.rulesetId !== session.ruleset_id
        || initialState.rulesetVersion !== session.ruleset_version
      ) throw new SessionRecoveryError("identity_mismatch");

      const playerEvents = parseEvents(this.database.prepare(`
        SELECT payload_json FROM player_events WHERE game_id = ? ORDER BY sequence
      `).all(gameId));
      const auditEvents = parseEvents(this.database.prepare(`
        SELECT payload_json FROM audit_events WHERE game_id = ? ORDER BY sequence
      `).all(gameId));
      const commandEvents = playerEvents.filter((event) => event.commandId !== undefined);
      const commandCommits = auditEvents.filter((event) => event.type === "command_committed");
      const recovered = restoreFromAuditJournal(initialState, {
        domainEvents: commandEvents,
        auditEvents: commandCommits,
      });
      if (!isDeepStrictEqual(recovered, storedState)) throw new SessionRecoveryError("state_mismatch");
      return { state: recovered, initialState, playerEvents, auditEvents };
    } catch (error) {
      this.database.prepare("UPDATE sessions SET status = 'recovery_failed' WHERE game_id = ?").run(gameId);
      if (error instanceof SessionRecoveryError) throw error;
      throw new SessionRecoveryError(error instanceof Error ? error.message : "unknown");
    }
  }
}
