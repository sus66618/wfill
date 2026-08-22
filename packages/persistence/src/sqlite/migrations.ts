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
}, {
  version: 2,
  sql: `
    CREATE TABLE model_accounts (
      account_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      base_url TEXT NOT NULL,
      credential_ref TEXT NOT NULL,
      configured INTEGER NOT NULL CHECK(configured IN (0, 1))
    ) STRICT;

    CREATE TABLE account_models (
      account_id TEXT NOT NULL REFERENCES model_accounts(account_id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      health_status TEXT NOT NULL CHECK(health_status IN ('unchecked', 'healthy', 'unhealthy')),
      last_checked_at TEXT,
      PRIMARY KEY (account_id, model_id)
    ) STRICT;

    CREATE TABLE session_seat_models (
      game_id TEXT NOT NULL REFERENCES sessions(game_id) ON DELETE CASCADE,
      seat INTEGER NOT NULL CHECK(seat BETWEEN 1 AND 24),
      account_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      PRIMARY KEY (game_id, seat),
      FOREIGN KEY (account_id, model_id) REFERENCES account_models(account_id, model_id)
    ) STRICT;

    CREATE TABLE model_calls (
      call_id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES sessions(game_id) ON DELETE CASCADE,
      seat INTEGER NOT NULL CHECK(seat BETWEEN 1 AND 24),
      account_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      latency_ms REAL NOT NULL CHECK(latency_ms >= 0),
      input_tokens INTEGER,
      output_tokens INTEGER,
      attempts INTEGER NOT NULL CHECK(attempts > 0),
      error_code TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX idx_model_calls_game ON model_calls(game_id, created_at, call_id);
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
