import { describe, expect, it } from "vitest";
import type { SeatId } from "@wfill/contracts";
import { runScriptedGame } from "../src/index.js";
import { GOOD_WIN_SCRIPT } from "./fixtures/good-win-script.js";
import { WOLF_WIN_SCRIPT } from "./fixtures/wolf-win-script.js";

describe("scripted full games", () => {
  it("reaches a deterministic good victory", () => {
    const result = runScriptedGame(GOOD_WIN_SCRIPT);

    expect(result.finalState.phase).toBe("settlement");
    expect(result.finalState.outcome).toBe("good_win");
    expect(result.events.at(-1)?.type).toBe("game_finished");
    expect(result.events.at(-1)).toMatchObject({ winner: "good" });
    expect(result.consumedCommandCount).toBe(GOOD_WIN_SCRIPT.commands.length);
    expect(result.invariantCheckCount).toBe(result.consumedCommandCount);
  });

  it("reaches a deterministic wolf victory", () => {
    const result = runScriptedGame(WOLF_WIN_SCRIPT);

    expect(result.finalState.phase).toBe("settlement");
    expect(result.finalState.outcome).toBe("wolf_win");
    expect(result.events.at(-1)).toMatchObject({
      type: "game_finished",
      winner: "werewolf",
    });
    expect(result.consumedCommandCount).toBe(WOLF_WIN_SCRIPT.commands.length);
    expect(result.invariantCheckCount).toBe(result.consumedCommandCount);
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
