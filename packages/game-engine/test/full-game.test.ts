import { describe, expect, it } from "vitest";
import type { GameEvent, SeatId } from "@wfill/contracts";
import { createGame, restoreFromAuditJournal, runScriptedGame } from "../src/index.js";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import { GOOD_WIN_SCRIPT } from "./fixtures/good-win-script.js";
import { WOLF_WIN_SCRIPT } from "./fixtures/wolf-win-script.js";

const SETUP_EVENT_TYPES = [
  "game_created",
  "role_assigned",
  "role_assigned",
  "role_assigned",
  "role_assigned",
  "role_assigned",
  "role_assigned",
] as const;

const keyEventTrace = (events: readonly GameEvent[]): object[] => events.flatMap((event) => {
  if (event.type === "night_resolved") {
    return [{ type: event.type, eliminatedSeats: event.eliminatedSeats }];
  }
  if (event.type === "player_eliminated") {
    return [{ type: event.type, seat: event.seat }];
  }
  if (event.type === "elimination_cause_recorded") {
    return [{ type: event.type, seat: event.seat, cause: event.cause }];
  }
  if (event.type === "exile_opened") {
    return [{ type: event.type, exiledSeat: event.exiledSeat }];
  }
  if (event.type === "game_finished") {
    return [{ type: event.type, winner: event.winner }];
  }
  return [];
});

describe("scripted full games", () => {
  it("reaches a deterministic good victory", () => {
    const result = runScriptedGame(GOOD_WIN_SCRIPT);
    const repeated = runScriptedGame(GOOD_WIN_SCRIPT);

    expect(repeated.finalState).toEqual(result.finalState);
    expect(repeated.events).toEqual(result.events);
    expect(repeated.auditEvents).toEqual(result.auditEvents);
    const initial = createGame({
      gameId: `scripted-${GOOD_WIN_SCRIPT.seed}`,
      ruleset: SIX_PLAYER_RULESET,
      seed: GOOD_WIN_SCRIPT.seed,
    }).state;
    const restored = restoreFromAuditJournal(initial, {
      domainEvents: result.events.slice(SETUP_EVENT_TYPES.length),
      auditEvents: result.auditEvents,
    });
    expect(restored).toEqual(result.finalState);
    const finalCommandId = result.auditEvents.at(-1)!.commandId!;
    expect(restored.processedCommandIds).toContain(finalCommandId);
    expect(result.finalState.phase).toBe("settlement");
    expect(result.finalState.outcome).toBe("good_win");
    expect(result.events.at(-1)?.type).toBe("game_finished");
    expect(result.events.at(-1)).toMatchObject({ winner: "good" });
    expect(result.consumedCommandCount).toBe(GOOD_WIN_SCRIPT.commands.length);
    expect(result.invariantCheckCount).toBe(result.consumedCommandCount);
    expect(result.events.map((event) => event.type)).toEqual([
      ...SETUP_EVENT_TYPES,
      "night_action_recorded",
      "night_action_recorded",
      "wolf_decision",
      "wolf_decision",
      "night_action_recorded",
      "night_action_recorded",
      "inspection_result",
      "night_resolved",
      "player_eliminated",
      "elimination_cause_recorded",
      "player_eliminated",
      "elimination_cause_recorded",
      "phase_advanced",
      "phase_advanced",
      "speech_published",
      "speech_published",
      "phase_advanced",
      "speech_published",
      "speech_published",
      "speech_published",
      "speech_published",
      "vote_accepted",
      "vote_accepted",
      "vote_accepted",
      "vote_accepted",
      "vote_revealed",
      "exile_opened",
      "speech_published",
      "player_eliminated",
      "elimination_cause_recorded",
      "game_finished",
    ]);
    expect(keyEventTrace(result.events)).toEqual([
      { type: "night_resolved", eliminatedSeats: [2, 3] },
      { type: "player_eliminated", seat: 2 },
      { type: "elimination_cause_recorded", seat: 2, cause: "poison" },
      { type: "player_eliminated", seat: 3 },
      { type: "elimination_cause_recorded", seat: 3, cause: "wolf_kill" },
      { type: "exile_opened", exiledSeat: 4 },
      { type: "player_eliminated", seat: 4 },
      { type: "elimination_cause_recorded", seat: 4, cause: "exile" },
      { type: "game_finished", winner: "good" },
    ]);
  });

  it("reaches a deterministic wolf victory", () => {
    const result = runScriptedGame(WOLF_WIN_SCRIPT);
    const repeated = runScriptedGame(WOLF_WIN_SCRIPT);

    expect(repeated.finalState).toEqual(result.finalState);
    expect(repeated.events).toEqual(result.events);
    expect(result.finalState.phase).toBe("settlement");
    expect(result.finalState.outcome).toBe("wolf_win");
    expect(result.events.at(-1)).toMatchObject({
      type: "game_finished",
      winner: "werewolf",
    });
    expect(result.consumedCommandCount).toBe(WOLF_WIN_SCRIPT.commands.length);
    expect(result.invariantCheckCount).toBe(result.consumedCommandCount);
    expect(result.events.map((event) => event.type)).toEqual([
      ...SETUP_EVENT_TYPES,
      "night_action_recorded",
      "night_action_recorded",
      "wolf_decision",
      "wolf_decision",
      "night_action_recorded",
      "night_action_recorded",
      "night_resolved",
      "player_eliminated",
      "elimination_cause_recorded",
      "player_eliminated",
      "elimination_cause_recorded",
      "phase_advanced",
      "phase_advanced",
      "speech_published",
      "speech_published",
      "phase_advanced",
      "speech_published",
      "speech_published",
      "speech_published",
      "speech_published",
      "vote_accepted",
      "vote_accepted",
      "vote_accepted",
      "vote_accepted",
      "vote_revealed",
      "exile_opened",
      "speech_published",
      "player_eliminated",
      "elimination_cause_recorded",
      "phase_advanced",
      "night_action_recorded",
      "night_action_recorded",
      "wolf_decision",
      "wolf_decision",
      "night_action_recorded",
      "night_resolved",
      "player_eliminated",
      "elimination_cause_recorded",
      "game_finished",
    ]);
    expect(keyEventTrace(result.events)).toEqual([
      { type: "night_resolved", eliminatedSeats: [4, 5] },
      { type: "player_eliminated", seat: 4 },
      { type: "elimination_cause_recorded", seat: 4, cause: "wolf_kill" },
      { type: "player_eliminated", seat: 5 },
      { type: "elimination_cause_recorded", seat: 5, cause: "poison" },
      { type: "exile_opened", exiledSeat: 3 },
      { type: "player_eliminated", seat: 3 },
      { type: "elimination_cause_recorded", seat: 3, cause: "exile" },
      { type: "night_resolved", eliminatedSeats: [2] },
      { type: "player_eliminated", seat: 2 },
      { type: "elimination_cause_recorded", seat: 2, cause: "wolf_kill" },
      { type: "game_finished", winner: "werewolf" },
    ]);
  });

  it("rejects a command that is absent from the current legal-action snapshot", () => {
    expect(() => runScriptedGame({
      seed: "good-win",
      commands: [{
        type: "submit_vote",
        actorSeat: 1 as SeatId,
        targetSeat: 2 as SeatId,
      }],
    })).toThrow("scripted_action_unavailable:0:submit_vote");
  });

  it("rejects a script that exhausts its commands before settlement", () => {
    expect(() => runScriptedGame({ seed: "good-win", commands: [] }))
      .toThrow("script_ended_before_game_finished");
  });

  it("caps scripts at 300 commands", () => {
    const commands = Array.from({ length: 301 }, () => ({
      type: "pass_action" as const,
      actorSeat: 2 as SeatId,
    }));

    expect(() => runScriptedGame({ seed: "good-win", commands }))
      .toThrow("script_command_limit_exceeded");
  });
});
