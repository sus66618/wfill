import { describe, expect, it } from "vitest";
import type { CommandId, GameCommand, SessionUpdate } from "@wfill/contracts";
import { applyCommand, createGame } from "@wfill/game-engine";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import {
  openSqliteDatabase,
  SqliteSessionRecoveryService,
  SqliteSessionRepository,
  SqliteUpdateLogRepository,
} from "../src/index.js";

const setupMixedJournal = () => {
  const database = openSqliteDatabase(":memory:");
  const repository = new SqliteSessionRepository(database);
  const created = createGame({ gameId: "recovery-game", ruleset: SIX_PLAYER_RULESET, seed: "recovery-seed" });
  repository.create({ initialState: created.state, state: created.state, playerEvents: created.events, auditEvents: [] });
  let state = created.state;
  const wolves = state.players.filter((player) => player.roleId === "werewolf");
  const target = state.players.find((player) => player.roleId !== "werewolf")!;
  const commands: GameCommand[] = [
    {
      commandId: "accepted-1" as CommandId,
      gameId: state.gameId,
      expectedVersion: state.version,
      actorSeat: wolves[0]!.seat,
      type: "submit_wolf_kill",
      targetSeat: target.seat,
    },
  ];
  const rejected: GameCommand = {
    commandId: "rejected-1" as CommandId,
    gameId: state.gameId,
    expectedVersion: state.version + 1,
    actorSeat: target.seat,
    type: "submit_speech",
    content: "夜间非法发言。",
  };
  commands.push(rejected);

  for (const command of commands) {
    const result = applyCommand(state, { ...command, expectedVersion: state.version });
    repository.appendTransition({
      gameId: state.gameId,
      expectedPreviousVersion: state.version,
      state: result.state,
      playerEvents: result.events,
      auditEvents: result.auditEvents ?? [],
      updates: [],
    });
    state = result.state;
  }
  return { database, repository, created, state, rejected };
};

describe("SQLite 审计恢复", () => {
  it("恢复接受与拒绝命令并保留幂等性", () => {
    const fixture = setupMixedJournal();
    const recovered = new SqliteSessionRecoveryService(fixture.database).recover(fixture.created.state.gameId);
    expect(recovered.state).toEqual(fixture.state);
    expect(applyCommand(recovered.state, fixture.rejected)).toEqual({ state: recovered.state, events: [] });
    fixture.repository.close();
  });

  it("最新快照与审计恢复不一致时失败关闭", () => {
    const fixture = setupMixedJournal();
    fixture.database.prepare("UPDATE sessions SET state_json = initial_state_json WHERE game_id = ?")
      .run(fixture.created.state.gameId);
    expect(() => new SqliteSessionRecoveryService(fixture.database).recover(fixture.created.state.gameId))
      .toThrow("session_recovery_state_mismatch");
    const row = fixture.database.prepare("SELECT status FROM sessions WHERE game_id = ?")
      .get(fixture.created.state.gameId);
    expect(row?.status).toBe("recovery_failed");
    fixture.repository.close();
  });

  it("拒绝缺失或乱序的命令提交记录", () => {
    const missing = setupMixedJournal();
    missing.database.prepare("DELETE FROM audit_events WHERE game_id = ? AND sequence = 2")
      .run(missing.created.state.gameId);
    expect(() => new SqliteSessionRecoveryService(missing.database).recover(missing.created.state.gameId))
      .toThrow(/invalid_audit_journal/);
    missing.repository.close();

    const reversed = setupMixedJournal();
    const rows = reversed.database.prepare(`
      SELECT sequence, payload_json FROM audit_events WHERE game_id = ? ORDER BY sequence
    `).all(reversed.created.state.gameId);
    reversed.database.prepare("UPDATE audit_events SET payload_json = ? WHERE game_id = ? AND sequence = 1")
      .run(rows[1]!.payload_json, reversed.created.state.gameId);
    reversed.database.prepare("UPDATE audit_events SET payload_json = ? WHERE game_id = ? AND sequence = 2")
      .run(rows[0]!.payload_json, reversed.created.state.gameId);
    expect(() => new SqliteSessionRecoveryService(reversed.database).recover(reversed.created.state.gameId))
      .toThrow(/invalid_audit_journal/);
    reversed.repository.close();
  });

  it("只向请求视角重放对应安全更新", () => {
    const database = openSqliteDatabase(":memory:");
    const repository = new SqliteSessionRepository(database);
    const created = createGame({ gameId: "updates-game", ruleset: SIX_PLAYER_RULESET, seed: "updates-seed" });
    repository.create({ initialState: created.state, state: created.state, playerEvents: created.events, auditEvents: [] });
    const updates: SessionUpdate[] = [
      { type: "runner_status", sequence: 1, gameId: created.state.gameId, audience: { kind: "public" }, mode: "running", inFlight: false },
      { type: "runner_status", sequence: 1, gameId: created.state.gameId, audience: { kind: "god" }, mode: "running", inFlight: false },
      { type: "runner_status", sequence: 1, gameId: created.state.gameId, audience: { kind: "seat", seat: 3 }, mode: "running", inFlight: false },
    ];
    repository.appendTransition({
      gameId: created.state.gameId,
      expectedPreviousVersion: created.state.version,
      state: created.state,
      playerEvents: [],
      auditEvents: [],
      updates,
    });
    const log = new SqliteUpdateLogRepository(database);
    expect(log.readAfter(created.state.gameId, 0, { kind: "public" })).toEqual([updates[0]]);
    expect(log.readAfter(created.state.gameId, 0, { kind: "god" })).toEqual([updates[1]]);
    expect(log.readAfter(created.state.gameId, 0, { kind: "seat", seat: 3 })).toEqual([updates[2]]);
    repository.close();
  });
});
