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
import { applyCommand, createGame, replayEvents } from "@wfill/game-engine";

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
    const replayed = replayEvents(created.state, [...accepted.events, ...(accepted.auditEvents ?? [])]);

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

  it("replays rejected commands while duplicate commands remain explicit no-ops", () => {
    const created = createGame({ gameId: "reject-replay", ruleset: SIX_PLAYER_RULESET, seed: "reject-seed" });
    const actor = created.state.players[0]!;
    const rejectedCommand: GameCommand = {
      commandId: "rejected-command" as CommandId,
      gameId: created.state.gameId,
      expectedVersion: created.state.version,
      actorSeat: actor.seat,
      type: "submit_speech",
      content: "夜里不能公开发言。",
    };
    const rejected = applyCommand(created.state, rejectedCommand);
    const replayed = replayEvents(created.state, rejected.events);

    expect(replayed.processedCommandIds).toContain(rejectedCommand.commandId);
    expect(replayed.version).toBe(rejected.state.version);
    expect(applyCommand(replayed, rejectedCommand)).toEqual({ state: replayed, events: [] });
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
