import { describe, expect, it } from "vitest";
import type { CommandId, GameCommand, GameId, SeatId } from "@wfill/contracts";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import { applyCommand, createGame } from "../src/index.js";
import type { GameState, PlayerState } from "../src/index.js";

const seat = (value: number): SeatId => value as SeatId;

const player = (seatNumber: number, roleId: string): PlayerState => ({
  seat: seat(seatNumber),
  roleId,
  alive: true,
  privateState: {
    wolfTeammateSeats: roleId === "werewolf"
      ? [seat(seatNumber === 1 ? 2 : 1)]
      : [],
    ...(roleId === "witch"
      ? { witchResources: { antidoteAvailable: true, poisonAvailable: true } }
      : {}),
  },
});

const fixedNightState = (): GameState => ({
  gameId: "game-night" as GameId,
  rulesetId: "six-player-classic-no-sheriff",
  rulesetVersion: "1.0.0",
  version: 0,
  phase: "night_wolf_discussion",
  players: [
    player(1, "werewolf"),
    player(2, "werewolf"),
    player(3, "villager"),
    player(4, "witch"),
    player(5, "seer"),
    player(6, "villager"),
  ],
  pendingEffects: [],
  processedCommandIds: [],
  night: {
    wolfConfirmationRound: 1,
    wolfSubmissions: [],
    submittedActorSeats: [],
    potionUsed: false,
  },
});

const runCommand = (
  state: GameState,
  input: Omit<GameCommand, "commandId" | "gameId" | "expectedVersion">,
  index: number,
) => applyCommand(state, {
  ...input,
  commandId: `command-${index}` as CommandId,
  gameId: state.gameId,
  expectedVersion: state.version,
} as GameCommand);

describe("night resolution", () => {
  it("resolves wolf kill, seer result, and one potion only after actions lock", () => {
    let state = fixedNightState();
    const events = [];

    for (const [index, input] of [
      { type: "submit_wolf_kill", actorSeat: seat(1), targetSeat: seat(3) },
      { type: "submit_wolf_kill", actorSeat: seat(2), targetSeat: seat(3) },
      { type: "inspect_player", actorSeat: seat(5), targetSeat: seat(1) },
      { type: "use_poison", actorSeat: seat(4), targetSeat: seat(6) },
    ].entries()) {
      const result = runCommand(state, input as Omit<GameCommand, "commandId" | "gameId" | "expectedVersion">, index + 1);
      state = result.state;
      events.push(...result.events);

      if (index < 3) {
        expect(state.players.every((entry) => entry.alive)).toBe(true);
      }
      if (index === 2) {
        expect(result.events.some((event) => event.type === "inspection_result")).toBe(false);
      }
    }

    expect(state.phase).toBe("day_speech");
    expect(state.lastNightEliminatedSeats).toEqual([seat(3), seat(6)]);
    expect(state.speech).toMatchObject({
      kind: "ordinary",
      eligibleSpeakerSeats: [seat(1), seat(2), seat(4), seat(5)],
      speakingOrder: [seat(1), seat(2), seat(4), seat(5)],
      limit: 220,
    });
    expect(state.players.find((entry) => entry.seat === seat(3))?.alive).toBe(false);
    expect(state.players.find((entry) => entry.seat === seat(6))?.alive).toBe(false);
    expect(state.players.find((entry) => entry.seat === seat(4))?.privateState.witchResources)
      .toEqual({ antidoteAvailable: true, poisonAvailable: false });
    expect(events.map((event) => event.type)).toContain("night_resolved");
    expect(events.filter((event) => event.type === "inspection_result"))
      .toEqual([expect.objectContaining({
        actorSeat: seat(5),
        targetSeat: seat(1),
        faction: "werewolf",
        audience: { kind: "private", seat: seat(5) },
      })]);
    expect(events.filter((event) => event.type === "night_resolved"))
      .toEqual([expect.objectContaining({ audience: { kind: "public" } })]);
  });

  it("uses one final-confirmation window and turns a second wolf disagreement into an empty kill", () => {
    let state = fixedNightState();

    for (const [index, input] of [
      { type: "submit_wolf_kill", actorSeat: seat(1), targetSeat: seat(3) },
      { type: "submit_wolf_kill", actorSeat: seat(2), targetSeat: seat(4) },
    ].entries()) {
      state = runCommand(state, input as Omit<GameCommand, "commandId" | "gameId" | "expectedVersion">, index + 1).state;
    }

    expect(state.phase).toBe("night_wolf_final_confirmation");
    expect(state.night.wolfConfirmationRound).toBe(2);

    const firstFinal = runCommand(
      state,
      { type: "submit_wolf_kill", actorSeat: seat(1), targetSeat: seat(3) },
      3,
    );
    const secondFinal = runCommand(
      firstFinal.state,
      { type: "submit_wolf_kill", actorSeat: seat(2), targetSeat: seat(4) },
      4,
    );

    expect(secondFinal.state.phase).toBe("night_seer_action");
    expect(secondFinal.state.night.wolfTargetSeat).toBeNull();
    expect(secondFinal.state.pendingEffects).toEqual([]);
    expect(secondFinal.events.filter((event) => event.type === "wolf_decision"))
      .toEqual([
        expect.objectContaining({
          recipientSeat: seat(1),
          audience: { kind: "private", seat: seat(1) },
        }),
        expect.objectContaining({
          recipientSeat: seat(2),
          audience: { kind: "private", seat: seat(2) },
        }),
      ]);
    expect(secondFinal.events.every((event) => event.audience.kind === "private")).toBe(true);
  });

  it("applies an antidote without allowing a poison in the same night", () => {
    let state = fixedNightState();

    for (const [index, input] of [
      { type: "submit_wolf_kill", actorSeat: seat(1), targetSeat: seat(3) },
      { type: "submit_wolf_kill", actorSeat: seat(2), targetSeat: seat(3) },
      { type: "inspect_player", actorSeat: seat(5), targetSeat: seat(1) },
    ].entries()) {
      state = runCommand(state, input as Omit<GameCommand, "commandId" | "gameId" | "expectedVersion">, index + 1).state;
    }

    const result = runCommand(state, { type: "use_antidote", actorSeat: seat(4) }, 4);

    expect(result.state.phase).toBe("day_speech");
    expect(result.state.players.find((entry) => entry.seat === seat(3))?.alive).toBe(true);
    expect(result.state.players.find((entry) => entry.seat === seat(4))?.privateState.witchResources)
      .toEqual({ antidoteAvailable: false, poisonAvailable: true });
    expect(result.state.night.potionUsed).toBe(true);
  });

  it("skips dead special-role windows and still resolves the night", () => {
    let state: GameState = {
      ...fixedNightState(),
      players: fixedNightState().players.map((entry) =>
        entry.roleId === "seer" || entry.roleId === "witch"
          ? { ...entry, alive: false }
          : entry),
    };

    const first = runCommand(
      state,
      { type: "submit_wolf_kill", actorSeat: seat(1), targetSeat: seat(3) },
      1,
    );
    const second = runCommand(
      first.state,
      { type: "submit_wolf_kill", actorSeat: seat(2), targetSeat: seat(3) },
      2,
    );
    state = second.state;

    expect(state.phase).toBe("day_speech");
    expect(state.players.find((entry) => entry.seat === seat(3))?.alive).toBe(false);
    expect(second.events.map((event) => event.type)).toContain("night_resolved");
  });

  it("reaches deterministic day speech from createGame through a complete real night", () => {
    let state = createGame({
      gameId: "game-reachable-day",
      ruleset: SIX_PLAYER_RULESET,
      seed: "reach-day",
    }).state;
    const wolves = state.players.filter((entry) => entry.roleId === "werewolf");
    const seer = state.players.find((entry) => entry.roleId === "seer")!;
    const witch = state.players.find((entry) => entry.roleId === "witch")!;

    let index = 1;
    for (const wolf of wolves) {
      state = runCommand(state, { type: "pass_action", actorSeat: wolf.seat }, index).state;
      index += 1;
    }
    state = runCommand(state, { type: "pass_action", actorSeat: seer.seat }, index).state;
    index += 1;
    const final = runCommand(state, { type: "pass_action", actorSeat: witch.seat }, index);

    expect(final.state.phase).toBe("day_speech");
    expect(final.state.dayNumber).toBe(1);
    expect(final.state.lastNightEliminatedSeats).toEqual([]);
    expect(final.state.speech).toEqual({
      kind: "ordinary",
      eligibleSpeakerSeats: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
      speakingOrder: [seat(4), seat(5), seat(6), seat(1), seat(2), seat(3)],
      submittedSpeakerSeats: [],
      limit: 220,
    });
    expect(final.events.map((event) => event.type)).toEqual([
      "night_action_recorded",
      "night_resolved",
      "phase_advanced",
      "phase_advanced",
    ]);
    expect(final.events.slice(-2)).toEqual([
      expect.objectContaining({ phase: "dawn", audience: { kind: "public" } }),
      expect.objectContaining({ phase: "day_speech", audience: { kind: "public" } }),
    ]);
  });
});
