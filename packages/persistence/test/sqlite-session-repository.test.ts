import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandId, GameCommand, GameId, SessionUpdate } from "@wfill/contracts";
import { applyCommand, createGame } from "@wfill/game-engine";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import { openSqliteDatabase, SqliteSessionRepository } from "../src/index.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const fixture = () => {
  const created = createGame({ gameId: "sqlite-game", ruleset: SIX_PLAYER_RULESET, seed: "sqlite-seed" });
  const wolf = created.state.players.find((player) => player.roleId === "werewolf")!;
  const target = created.state.players.find((player) => player.roleId !== "werewolf")!;
  const command: GameCommand = {
    commandId: "sqlite-command" as CommandId,
    gameId: created.state.gameId,
    expectedVersion: created.state.version,
    actorSeat: wolf.seat,
    type: "submit_wolf_kill",
    targetSeat: target.seat,
  };
  return { created, accepted: applyCommand(created.state, command) };
};

const updateFor = (gameId: GameId, sequence: number): SessionUpdate => ({
  type: "runner_status",
  sequence,
  gameId,
  mode: "running",
  inFlight: false,
});

describe("SQLite 会话仓储", () => {
  it("原子保存命令转换并按原顺序恢复", () => {
    const { created, accepted } = fixture();
    const database = openSqliteDatabase(":memory:");
    const repository = new SqliteSessionRepository(database);
    repository.create({
      initialState: created.state,
      state: created.state,
      playerEvents: created.events,
      auditEvents: [],
    });
    repository.appendTransition({
      gameId: created.state.gameId,
      expectedPreviousVersion: created.state.version,
      state: accepted.state,
      playerEvents: accepted.events,
      auditEvents: accepted.auditEvents ?? [],
      updates: [updateFor(created.state.gameId, 1)],
    });

    const loaded = repository.load(created.state.gameId);
    expect(loaded?.state).toEqual(accepted.state);
    expect(loaded?.playerEvents).toEqual([...created.events, ...accepted.events]);
    expect(loaded?.auditEvents).toEqual(accepted.auditEvents);
    repository.close();
  });

  it("任一审计写入失败时回滚整个转换", () => {
    const { created, accepted } = fixture();
    const repository = new SqliteSessionRepository(openSqliteDatabase(":memory:"));
    repository.create({ initialState: created.state, state: created.state, playerEvents: created.events, auditEvents: [] });
    const duplicatedAudit = accepted.auditEvents?.[0];
    expect(duplicatedAudit).toBeDefined();

    expect(() => repository.appendTransition({
      gameId: created.state.gameId,
      expectedPreviousVersion: created.state.version,
      state: accepted.state,
      playerEvents: accepted.events,
      auditEvents: [duplicatedAudit!, duplicatedAudit!],
      updates: [updateFor(created.state.gameId, 1)],
    })).toThrow();

    expect(repository.load(created.state.gameId)?.state.version).toBe(created.state.version);
    repository.close();
  });

  it("关闭并重新打开文件数据库后保持完整会话", () => {
    const directory = mkdtempSync(join(tmpdir(), "wfill-sqlite-"));
    directories.push(directory);
    const path = join(directory, "sessions.db");
    const { created, accepted } = fixture();
    const first = new SqliteSessionRepository(openSqliteDatabase(path));
    first.create({ initialState: created.state, state: created.state, playerEvents: created.events, auditEvents: [] });
    first.appendTransition({
      gameId: created.state.gameId,
      expectedPreviousVersion: created.state.version,
      state: accepted.state,
      playerEvents: accepted.events,
      auditEvents: accepted.auditEvents ?? [],
      updates: [],
    });
    first.close();

    const reopened = new SqliteSessionRepository(openSqliteDatabase(path));
    expect(reopened.load(created.state.gameId)?.state).toEqual(accepted.state);
    reopened.close();
  });

  it("版本冲突不会写入部分数据", () => {
    const { created, accepted } = fixture();
    const repository = new SqliteSessionRepository(openSqliteDatabase(":memory:"));
    repository.create({ initialState: created.state, state: created.state, playerEvents: created.events, auditEvents: [] });
    expect(() => repository.appendTransition({
      gameId: created.state.gameId,
      expectedPreviousVersion: created.state.version - 1,
      state: accepted.state,
      playerEvents: accepted.events,
      auditEvents: accepted.auditEvents ?? [],
      updates: [],
    })).toThrow("persistence_version_conflict");
    expect(repository.load(created.state.gameId)?.playerEvents).toEqual(created.events);
    repository.close();
  });
});
