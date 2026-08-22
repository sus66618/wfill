import { describe, expect, it } from "vitest";
import type { CommandId, GameCommand, GameId, SeatId } from "@wfill/contracts";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import { applyCommand, assertGameState, createGame } from "../src/index.js";
import type { GameState, PlayerState } from "../src/index.js";

const seat = (value: number): SeatId => value as SeatId;

const player = (seatNumber: number, roleId: string, alive = true): PlayerState => ({
  seat: seat(seatNumber),
  roleId,
  alive,
  privateState: {
    wolfTeammateSeats: roleId === "werewolf"
      ? [seat(seatNumber === 1 ? 2 : 1)]
      : [],
    ...(roleId === "witch"
      ? { witchResources: { antidoteAvailable: true, poisonAvailable: true } }
      : {}),
  },
});

const makeState = (): GameState => ({
  gameId: "invariants" as GameId,
  rulesetId: SIX_PLAYER_RULESET.id,
  rulesetVersion: SIX_PLAYER_RULESET.version,
  version: 10,
  phase: "night_seer_action",
  outcome: "ongoing",
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

describe("game state invariants", () => {
  it("rejects a state with duplicate seat numbers", () => {
    const state = makeState();
    const duplicateSeats = {
      ...state,
      players: state.players.map((entry) => entry.seat === seat(6)
        ? { ...entry, seat: seat(5) }
        : entry),
    };

    expect(() => assertGameState(duplicateSeats)).toThrow("duplicate_seat");
  });

  it("rejects setup outside the exact six-seat rules engine boundary", () => {
    expect(() => createGame({
      gameId: "five-seat-game",
      ruleset: { ...SIX_PLAYER_RULESET, roster: SIX_PLAYER_RULESET.roster.slice(0, 5) },
      seed: "five-seat-seed",
    })).toThrow("exact_six_seats");
  });

  it.each([
    ["invalid_version", { version: -1 }],
    ["invalid_phase", { phase: "coffee_break" }],
    ["negative_resource", { dayNumber: -1 }],
  ])("rejects %s", (reason, override) => {
    expect(() => assertGameState({ ...makeState(), ...override } as GameState)).toThrow(reason);
  });

  it("rejects non-monotonic accepted transitions", () => {
    const state = makeState();

    expect(() => assertGameState(state, state.version)).toThrow("non_monotonic_version");
  });

  it("rejects dead night actors", () => {
    const state = makeState();
    const players = state.players.map((entry) => entry.seat === seat(5)
      ? { ...entry, alive: false }
      : entry);

    expect(() => assertGameState({
      ...state,
      players,
      night: { ...state.night, submittedActorSeats: [seat(5)] },
    })).toThrow("dead_actor");
  });

  it("rejects duplicate processed command IDs", () => {
    const duplicateId = "already-seen" as CommandId;

    expect(() => assertGameState({
      ...makeState(),
      processedCommandIds: [duplicateId, duplicateId],
    })).toThrow("duplicate_command_id");
  });

  it("asserts every accepted command result", () => {
    const state = {
      ...makeState(),
      processedCommandIds: ["old-command" as CommandId, "old-command" as CommandId],
    };
    const command = {
      type: "inspect_player",
      commandId: "new-command" as CommandId,
      gameId: state.gameId,
      expectedVersion: state.version,
      actorSeat: seat(5),
      targetSeat: seat(3),
    } satisfies GameCommand;

    expect(() => applyCommand(state, command)).toThrow("duplicate_command_id");
  });

  it("keeps duplicate command replay as an exact no-op", () => {
    const commandId = "same-command" as CommandId;
    const state = { ...makeState(), processedCommandIds: [commandId] };
    const command = {
      type: "inspect_player",
      commandId,
      gameId: state.gameId,
      expectedVersion: state.version,
      actorSeat: seat(5),
      targetSeat: seat(3),
    } satisfies GameCommand;

    const result = applyCommand(state, command);

    expect(result).toEqual({ state, events: [] });
    expect(result.state).toBe(state);
    expect(result.state.version).toBe(10);
  });
});
