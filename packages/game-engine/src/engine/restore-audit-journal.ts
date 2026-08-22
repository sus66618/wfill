import type { CommandId, GameEvent } from "@wfill/contracts";
import { assertGameState } from "./assert-invariants.js";
import type { GameState } from "../state/game-state.js";

export interface AuditJournal {
  readonly domainEvents: readonly GameEvent[];
  readonly auditEvents: readonly GameEvent[];
}

const fail = (reason: string): never => {
  throw new Error(`invalid_audit_journal:${reason}`);
};

/**
 * 从裁判持久化的完整审计日志恢复状态。
 * 这不是公开领域事件 reducer；缺少 god-only command commit 时会明确拒绝。
 */
export const restoreFromAuditJournal = (
  initialState: GameState,
  journal: AuditJournal,
): GameState => {
  const processedEvents = journal.domainEvents;
  if (processedEvents.length > 0 && journal.auditEvents.length === 0) fail("missing_commits");

  let expectedEventVersion = initialState.version + 1;
  const lastVersionByCommand = new Map<CommandId, number>();
  const commandOrder: CommandId[] = [];
  const closedCommands = new Set<CommandId>();
  let activeCommandId: CommandId | undefined;
  for (const event of processedEvents) {
    if (event.gameId !== initialState.gameId) fail("game_mismatch");
    if (event.rulesetId !== initialState.rulesetId || event.rulesetVersion !== initialState.rulesetVersion) {
      fail("ruleset_mismatch");
    }
    if (event.version !== expectedEventVersion) fail("domain_version_gap");
    expectedEventVersion += 1;
    if (event.commandId === undefined) fail("missing_command_id");
    const commandId = event.commandId as CommandId;
    if (activeCommandId !== commandId) {
      if (activeCommandId !== undefined) closedCommands.add(activeCommandId);
      if (closedCommands.has(commandId)) fail("non_contiguous_command_events");
      activeCommandId = commandId;
      commandOrder.push(commandId);
    }
    lastVersionByCommand.set(commandId, event.version);
  }

  if (journal.auditEvents.length !== commandOrder.length) fail("commit_count_mismatch");
  let state = initialState;
  const committed = new Set<CommandId>();
  let previousCommitVersion = initialState.version;
  for (const [index, event] of journal.auditEvents.entries()) {
    if (event.type !== "command_committed") fail("non_commit_event");
    const commit = event as Extract<GameEvent, { type: "command_committed" }>;
    if (commit.audience.kind !== "god") fail("non_commit_event");
    const commandId = commit.commandId as CommandId;
    const expectedCommandId = commandOrder[index];
    if (expectedCommandId === undefined || commandId !== expectedCommandId) fail("commit_order_mismatch");
    if (committed.has(commandId)) fail("duplicate_commit");
    committed.add(commandId);
    if (commit.gameId !== initialState.gameId) fail("game_mismatch");
    if (commit.rulesetId !== initialState.rulesetId || commit.rulesetVersion !== initialState.rulesetVersion) {
      fail("ruleset_mismatch");
    }
    if (commit.version !== lastVersionByCommand.get(commandId)) fail("stale_commit");
    if (commit.version <= previousCommitVersion) fail("non_monotonic_commit");
    previousCommitVersion = commit.version;
    const snapshot = commit.state as unknown as GameState;
    if (
      snapshot.gameId !== initialState.gameId
      || snapshot.rulesetId !== initialState.rulesetId
      || snapshot.rulesetVersion !== initialState.rulesetVersion
    ) fail("snapshot_identity_mismatch");
    if (snapshot.version !== commit.version) fail("snapshot_version_mismatch");
    const expectedProcessedIds = [
      ...initialState.processedCommandIds,
      ...commandOrder.slice(0, index + 1),
    ];
    if (
      snapshot.processedCommandIds.length !== expectedProcessedIds.length
      || snapshot.processedCommandIds.some((id, idIndex) => id !== expectedProcessedIds[idIndex])
    ) fail("snapshot_processed_commands_mismatch");
    state = snapshot;
  }

  assertGameState(state);
  return state;
};
