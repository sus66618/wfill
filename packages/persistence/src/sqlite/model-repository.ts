import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { modelAccountSchema, type ModelAccount } from "@wfill/model-gateway";
import { GameIdSchema, SeatIdSchema, type GameId, type SeatId } from "@wfill/contracts";

const healthSchema = z.enum(["unchecked", "healthy", "unhealthy"]);

const storedModelSchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean(),
  health: healthSchema,
  lastCheckedAt: z.string().datetime().nullable(),
}).strict();

const seatBindingSchema = z.object({
  seat: SeatIdSchema,
  accountId: z.string().min(1),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
}).strict();

const modelCallSchema = z.object({
  callId: z.string().min(1),
  gameId: GameIdSchema,
  seat: SeatIdSchema,
  accountId: z.string().min(1),
  modelId: z.string().min(1),
  purpose: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  attempts: z.number().int().positive(),
  errorCode: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
}).strict();

export type StoredModel = z.infer<typeof storedModelSchema>;
export type SessionSeatModelBinding = z.infer<typeof seatBindingSchema>;
export type ModelCallMetadata = z.infer<typeof modelCallSchema>;

export interface PlayableModelRecord {
  readonly accountId: string;
  readonly accountDisplayName: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly health: "healthy";
}

export class SqliteModelRepository {
  constructor(private readonly database: DatabaseSync) {}

  upsertAccount(input: ModelAccount, configured: boolean): void {
    const account = modelAccountSchema.parse(input);
    this.database.prepare(`
      INSERT INTO model_accounts(account_id, display_name, provider_kind, base_url, credential_ref, configured)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        display_name = excluded.display_name,
        provider_kind = excluded.provider_kind,
        base_url = excluded.base_url,
        credential_ref = excluded.credential_ref,
        configured = excluded.configured
    `).run(
      account.accountId,
      account.displayName,
      account.providerKind,
      account.baseUrl,
      account.credentialRef,
      configured ? 1 : 0,
    );
  }

  replaceModels(accountId: string, inputs: readonly StoredModel[]): void {
    const models = inputs.map((input) => storedModelSchema.parse(input));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM account_models WHERE account_id = ?").run(accountId);
      const insert = this.database.prepare(`
        INSERT INTO account_models(account_id, model_id, display_name, enabled, health_status, last_checked_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const model of models) {
        insert.run(accountId, model.modelId, model.displayName, model.enabled ? 1 : 0, model.health, model.lastCheckedAt);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listPlayableModels(): readonly PlayableModelRecord[] {
    return this.database.prepare(`
      SELECT a.account_id, a.display_name AS account_display_name, m.model_id, m.display_name
      FROM model_accounts a JOIN account_models m ON m.account_id = a.account_id
      WHERE a.configured = 1 AND m.enabled = 1 AND m.health_status = 'healthy'
      ORDER BY a.account_id, m.model_id
    `).all().map((row) => ({
      accountId: String(row.account_id),
      accountDisplayName: String(row.account_display_name),
      modelId: String(row.model_id),
      displayName: String(row.display_name),
      health: "healthy" as const,
    }));
  }

  bindSessionSeats(gameIdInput: GameId, inputs: readonly SessionSeatModelBinding[]): void {
    const gameId = GameIdSchema.parse(gameIdInput);
    const bindings = inputs.map((input) => seatBindingSchema.parse(input));
    if (new Set(bindings.map((binding) => binding.seat)).size !== bindings.length) {
      throw new Error("model_seat_binding_duplicate");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM session_seat_models WHERE game_id = ?").run(gameId);
      const insert = this.database.prepare(`
        INSERT INTO session_seat_models(game_id, seat, account_id, model_id, display_name)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const binding of bindings) {
        insert.run(gameId, binding.seat, binding.accountId, binding.modelId, binding.displayName);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadSeatBindings(gameId: GameId): readonly SessionSeatModelBinding[] {
    return this.database.prepare(`
      SELECT seat, account_id, model_id, display_name
      FROM session_seat_models WHERE game_id = ? ORDER BY seat
    `).all(gameId).map((row) => seatBindingSchema.parse({
      seat: Number(row.seat),
      accountId: String(row.account_id),
      modelId: String(row.model_id),
      displayName: String(row.display_name),
    }));
  }

  recordCall(input: ModelCallMetadata): void {
    const call = modelCallSchema.safeParse(input);
    if (!call.success) throw new Error("model_call_metadata_invalid");
    this.database.prepare(`
      INSERT INTO model_calls(
        call_id, game_id, seat, account_id, model_id, purpose, latency_ms,
        input_tokens, output_tokens, attempts, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      call.data.callId, call.data.gameId, call.data.seat, call.data.accountId, call.data.modelId,
      call.data.purpose, call.data.latencyMs, call.data.inputTokens, call.data.outputTokens,
      call.data.attempts, call.data.errorCode, call.data.createdAt,
    );
  }

  listCallsForGame(gameId: GameId): readonly ModelCallMetadata[] {
    return this.database.prepare(`
      SELECT * FROM model_calls WHERE game_id = ? ORDER BY created_at, call_id
    `).all(gameId).map((row) => modelCallSchema.parse({
      callId: String(row.call_id),
      gameId: String(row.game_id),
      seat: Number(row.seat) as SeatId,
      accountId: String(row.account_id),
      modelId: String(row.model_id),
      purpose: String(row.purpose),
      latencyMs: Number(row.latency_ms),
      inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
      outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
      attempts: Number(row.attempts),
      errorCode: row.error_code === null ? null : String(row.error_code),
      createdAt: String(row.created_at),
    }));
  }

  close(): void {
    this.database.close();
  }
}
