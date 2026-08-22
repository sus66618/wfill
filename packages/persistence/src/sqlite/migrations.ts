import type { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE sessions (
      game_id TEXT PRIMARY KEY,
      ruleset_id TEXT NOT NULL,
      ruleset_version TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      initial_state_json TEXT NOT NULL,
      state_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    ) STRICT;

    CREATE TABLE player_events (
      game_id TEXT NOT NULL REFERENCES sessions(game_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      event_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (game_id, sequence),
      UNIQUE (game_id, event_id)
    ) STRICT;

    CREATE TABLE audit_events (
      game_id TEXT NOT NULL REFERENCES sessions(game_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      event_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (game_id, sequence),
      UNIQUE (game_id, event_id)
    ) STRICT;

    CREATE TABLE session_updates (
      game_id TEXT NOT NULL REFERENCES sessions(game_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      audience_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (game_id, sequence, audience_key)
    ) STRICT;

    CREATE INDEX idx_player_events_version ON player_events(game_id, version);
    CREATE INDEX idx_audit_events_version ON audit_events(game_id, version);
    CREATE INDEX idx_session_updates_sequence ON session_updates(game_id, sequence);
  `,
}];

export const runMigrations = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = database.prepare("SELECT version FROM schema_migrations").all()
    .map((row) => Number(row.version));

  for (const migration of MIGRATIONS) {
    if (applied.includes(migration.version)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(migration.version, new Date(0).toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
};
