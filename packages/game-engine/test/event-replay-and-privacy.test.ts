import { describe, expect, it } from "vitest";
import {
  filterEventsForAudience,
  GameEventSchema,
  type CommandId,
  type GameCommand,
  type GameEvent,
  type SeatId,
} from "@wfill/contracts";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import { applyCommand, createGame, restoreFromAuditJournal } from "@wfill/game-engine";

const seat = (value: number): SeatId => value as SeatId;

describe("event replay and privacy", () => {
  it("replays an accepted command and restores idempotency from god-only audit events", () => {
    const created = createGame({ gameId: "replay-game", ruleset: SIX_PLAYER_RULESET, seed: "replay-seed" });
    const wolf = created.state.players.find((player) => player.roleId === "werewolf")!;
    const target = created.state.players.find((player) => player.roleId !== "werewolf")!;
    const command: GameCommand = {
      commandId: "replay-command" as CommandId,
      gameId: created.state.gameId,
      expectedVersion: created.state.version,
      actorSeat: wolf.seat,
      type: "submit_wolf_kill",
      targetSeat: target.seat,
    };
    const accepted = applyCommand(created.state, command);
    const replayed = restoreFromAuditJournal(created.state, {
      domainEvents: accepted.events,
      auditEvents: accepted.auditEvents ?? [],
    });

    expect(replayed).toEqual(accepted.state);
    expect(replayed.processedCommandIds).toContain(command.commandId);
    expect(applyCommand(replayed, command)).toEqual({ state: replayed, events: [] });
    expect(accepted.events.every((event) => event.commandId === command.commandId)).toBe(true);
    expect(accepted.events[0]).toMatchObject({
      rulesetId: SIX_PLAYER_RULESET.id,
      rulesetVersion: SIX_PLAYER_RULESET.version,
      dayNumber: 0,
      phase: "night_wolf_discussion",
    });
    expect([...accepted.events, ...(accepted.auditEvents ?? [])]
      .every((event) => GameEventSchema.safeParse(event).success)).toBe(true);
  });

  it("rejects missing, reversed, duplicate, stale, and identity-mismatched commits", () => {
    const created = createGame({ gameId: "journal-validation", ruleset: SIX_PLAYER_RULESET, seed: "journal-seed" });
    let state = created.state;
    const wolves = state.players.filter((player) => player.roleId === "werewolf");
    const target = state.players.find((player) => player.roleId !== "werewolf")!;
    const domainEvents: GameEvent[] = [];
    const auditEvents: GameEvent[] = [];
    for (const [index, wolf] of wolves.entries()) {
      const result = applyCommand(state, {
        commandId: `journal-${index + 1}` as CommandId,
        gameId: state.gameId,
        expectedVersion: state.version,
        actorSeat: wolf.seat,
        type: "submit_wolf_kill",
        targetSeat: target.seat,
      });
      state = result.state;
      domainEvents.push(...result.events);
      auditEvents.push(...(result.auditEvents ?? []));
    }
    const restore = (audits: readonly GameEvent[], domains = domainEvents) =>
      restoreFromAuditJournal(created.state, { domainEvents: domains, auditEvents: audits });

    expect(() => restore([])).toThrow("invalid_audit_journal:missing_commits");
    expect(() => restore([...auditEvents].reverse())).toThrow("invalid_audit_journal:commit_order_mismatch");
    expect(() => restore([auditEvents[0]!, auditEvents[0]!])).toThrow();
    expect(() => restore([{ ...auditEvents[0]!, version: auditEvents[0]!.version - 1 }, auditEvents[1]!]))
      .toThrow("invalid_audit_journal:stale_commit");
    expect(() => restore([{ ...auditEvents[0]!, gameId: "another-game" }, auditEvents[1]!]))
      .toThrow("invalid_audit_journal:game_mismatch");
    expect(() => restore(auditEvents, domainEvents.slice(1)))
      .toThrow("invalid_audit_journal:domain_version_gap");
    const firstCommit = auditEvents[0] as Extract<GameEvent, { type: "command_committed" }>;
    const firstSnapshot = firstCommit.state as unknown as ReturnType<typeof createGame>["state"];
    expect(() => restore([{
      ...firstCommit,
      state: { ...firstSnapshot, processedCommandIds: [...firstSnapshot.processedCommandIds, "forged-id"] },
    }, auditEvents[1]!])).toThrow("invalid_audit_journal:snapshot_processed_commands_mismatch");
    expect(() => restore([{
      ...firstCommit,
      state: { ...firstSnapshot, processedCommandIds: [] },
    }, auditEvents[1]!])).toThrow("invalid_audit_journal:snapshot_processed_commands_mismatch");
  });

  it("restores accepted and rejected commands with exact processed-ID history", () => {
    const created = createGame({ gameId: "mixed-journal", ruleset: SIX_PLAYER_RULESET, seed: "mixed-seed" });
    const wolves = created.state.players.filter((player) => player.roleId === "werewolf");
    const target = created.state.players.find((player) => player.roleId !== "werewolf")!;
    let state = created.state;
    const domainEvents: GameEvent[] = [];
    const auditEvents: GameEvent[] = [];
    const apply = (command: GameCommand) => {
      const result = applyCommand(state, command);
      state = result.state;
      domainEvents.push(...result.events);
      auditEvents.push(...(result.auditEvents ?? []));
    };

    apply({
      commandId: "mixed-accepted-1" as CommandId,
      gameId: state.gameId,
      expectedVersion: state.version,
      actorSeat: wolves[0]!.seat,
      type: "submit_wolf_kill",
      targetSeat: target.seat,
    });
    const rejectedCommand: GameCommand = {
      commandId: "mixed-rejected" as CommandId,
      gameId: state.gameId,
      expectedVersion: state.version,
      actorSeat: target.seat,
      type: "submit_speech",
      content: "夜间非法发言。",
    };
    apply(rejectedCommand);
    apply({
      commandId: "mixed-accepted-2" as CommandId,
      gameId: state.gameId,
      expectedVersion: state.version,
      actorSeat: wolves[1]!.seat,
      type: "submit_wolf_kill",
      targetSeat: target.seat,
    });

    const restored = restoreFromAuditJournal(created.state, { domainEvents, auditEvents });
    expect(restored).toEqual(state);
    expect(restored.processedCommandIds).toEqual([
      "mixed-accepted-1",
      "mixed-rejected",
      "mixed-accepted-2",
    ]);
    expect(applyCommand(restored, rejectedCommand)).toEqual({ state: restored, events: [] });
    expect(domainEvents.find((event) => event.type === "action_rejected")?.audience)
      .toEqual({ kind: "private", seat: target.seat });
  });

  it("shows a death without cause publicly and reveals cause only in god projection", () => {
    const publicDeath = {
      eventId: "death-public",
      gameId: "privacy-game",
      version: 1,
      type: "player_eliminated",
      seat: seat(3),
      audience: { kind: "public" },
    } as GameEvent;
    const cause = {
      eventId: "death-cause",
      gameId: "privacy-game",
      version: 2,
      type: "elimination_cause_recorded",
      seat: seat(3),
      cause: "poison",
      audience: { kind: "god" },
    } as GameEvent;
    const stream = [publicDeath, cause];

    expect(filterEventsForAudience(stream, { kind: "public" })).toEqual([publicDeath]);
    expect(filterEventsForAudience(stream, { kind: "private", seat: seat(3) })).toEqual([publicDeath]);
    expect(filterEventsForAudience(stream, { kind: "god" })).toEqual(stream);
  });
});
