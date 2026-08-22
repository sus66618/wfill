import type { DatabaseSync } from "node:sqlite";
import {
  sessionUpdateSchema,
  type GameId,
  type SessionUpdate,
  type SpectatorMode,
} from "@wfill/contracts";

const audienceKey = (mode: SpectatorMode): string => mode.kind === "seat" ? `seat:${mode.seat}` : mode.kind;

export class SqliteUpdateLogRepository {
  constructor(private readonly database: DatabaseSync) {}

  readAfter(gameId: GameId, sequence: number, mode: SpectatorMode): readonly SessionUpdate[] {
    const rows = this.database.prepare(`
      SELECT payload_json FROM session_updates
      WHERE game_id = ? AND audience_key = ? AND sequence > ?
      ORDER BY sequence
    `).all(gameId, audienceKey(mode), sequence);
    return rows.map((row) => {
      const update = sessionUpdateSchema.parse(JSON.parse(String(row.payload_json)));
      if (audienceKey(update.audience) !== audienceKey(mode)) {
        throw new Error("persistence_update_audience_mismatch");
      }
      return update;
    });
  }
}

