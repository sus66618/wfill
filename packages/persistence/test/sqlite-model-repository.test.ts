import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GameId, SeatId } from "@wfill/contracts";
import type { ModelAccount } from "@wfill/model-gateway";
import { createGame } from "@wfill/game-engine";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import {
  openSqliteDatabase,
  SqliteModelRepository,
  SqliteSessionRepository,
} from "../src/index.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

const account: ModelAccount = {
  accountId: "school-account", displayName: "学校网关", providerKind: "openai-compatible",
  baseUrl: "http://aigw.dlut.edu.cn/v1", credentialRef: "school-key",
};

const openFile = () => {
  const directory = mkdtempSync(join(tmpdir(), "wfill-model-repo-"));
  directories.push(directory);
  const path = join(directory, "models.sqlite");
  const database = openSqliteDatabase(path);
  return { path, database, models: new SqliteModelRepository(database) };
};

const createSession = (database: ReturnType<typeof openSqliteDatabase>, gameId: string): GameId => {
  const created = createGame({ gameId, ruleset: SIX_PLAYER_RULESET, seed: "good-win" });
  new SqliteSessionRepository(database).create({
    initialState: created.state, state: created.state, playerEvents: created.events, auditEvents: [],
  });
  return created.state.gameId;
};

describe("SQLite 模型配置和调用元数据", () => {
  it("保存非敏感账户、模型健康和可玩目录", () => {
    const { database, models } = openFile();
    models.upsertAccount(account, true);
    models.replaceModels(account.accountId, [
      { modelId: "Qwen3.5-9B", displayName: "Qwen3.5-9B", enabled: true, health: "healthy", lastCheckedAt: "2026-08-22T00:00:00.000Z" },
      { modelId: "GLM-4.6-W8A8", displayName: "GLM-4.6-W8A8", enabled: true, health: "unhealthy", lastCheckedAt: "2026-08-22T00:00:00.000Z" },
    ]);
    expect(models.listPlayableModels()).toEqual([{
      accountId: "school-account", accountDisplayName: "学校网关", modelId: "Qwen3.5-9B",
      displayName: "Qwen3.5-9B", health: "healthy",
    }]);
    const dump = JSON.stringify(database.prepare("SELECT * FROM model_accounts").all());
    expect(dump).not.toMatch(/api.?key|authorization|school-secret/i);
    models.close();
  });

  it("绑定六席模型并在文件重开后恢复", () => {
    const first = openFile();
    const gameId = createSession(first.database, "model-bindings");
    first.models.upsertAccount(account, true);
    first.models.replaceModels(account.accountId, [{
      modelId: "Qwen3.5-9B", displayName: "Qwen3.5-9B", enabled: true, health: "healthy", lastCheckedAt: null,
    }]);
    first.models.bindSessionSeats(gameId, Array.from({ length: 6 }, (_, index) => ({
      seat: (index + 1) as SeatId, accountId: account.accountId, modelId: "Qwen3.5-9B", displayName: "Qwen3.5-9B",
    })));
    first.models.close();

    const reopenedDatabase = openSqliteDatabase(first.path);
    const reopened = new SqliteModelRepository(reopenedDatabase);
    expect(reopened.loadSeatBindings(gameId)).toHaveLength(6);
    expect(reopened.loadSeatBindings(gameId)[0]).toMatchObject({ seat: 1, modelId: "Qwen3.5-9B" });
    reopened.close();
  });

  it("记录调用数字但拒绝秘密和原始报文属性", () => {
    const { database, models } = openFile();
    const gameId = createSession(database, "model-calls");
    models.recordCall({
      callId: "call-1", gameId, seat: 2 as SeatId, accountId: "school-account", modelId: "Qwen3.5-9B",
      purpose: "day_vote", latencyMs: 321, inputTokens: 120, outputTokens: 8, attempts: 2,
      errorCode: null, createdAt: "2026-08-22T00:00:00.000Z",
    });
    expect(models.listCallsForGame(gameId)).toEqual([expect.objectContaining({ callId: "call-1", inputTokens: 120, attempts: 2 })]);
    expect(() => models.recordCall({
      callId: "call-2", gameId, seat: 2 as SeatId, accountId: "school-account", modelId: "Qwen3.5-9B",
      purpose: "day_vote", latencyMs: 1, inputTokens: null, outputTokens: null, attempts: 1,
      errorCode: null, createdAt: "2026-08-22T00:00:00.000Z", apiKey: "school-secret",
    } as never)).toThrow("model_call_metadata_invalid");
    models.close();
  });

  it("模型目录替换失败时保持旧目录", () => {
    const { models } = openFile();
    models.upsertAccount(account, true);
    models.replaceModels(account.accountId, [{
      modelId: "Qwen3.5-9B", displayName: "Qwen3.5-9B", enabled: true, health: "healthy", lastCheckedAt: null,
    }]);
    expect(() => models.replaceModels(account.accountId, [{
      modelId: "", displayName: "bad", enabled: true, health: "healthy", lastCheckedAt: null,
    }])).toThrow();
    expect(models.listPlayableModels()).toHaveLength(1);
    models.close();
  });
});
