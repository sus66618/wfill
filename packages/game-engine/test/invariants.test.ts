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

let flowCommandIndex = 0;
const runFlowCommand = (
  state: GameState,
  input: Omit<GameCommand, "commandId" | "gameId" | "expectedVersion">,
) => applyCommand(state, {
  ...input,
  commandId: `invariant-flow-${flowCommandIndex += 1}` as CommandId,
  gameId: state.gameId,
  expectedVersion: state.version,
} as GameCommand);

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

  it("rejects a ruleset that declares five players with a six-role roster", () => {
    expect(() => createGame({
      gameId: "wrong-declared-count",
      ruleset: { ...SIX_PLAYER_RULESET, playerCount: 5 },
      seed: "wrong-declared-count-seed",
    })).toThrow("exact_six_seats");
  });

  it("rejects an unsupported six-seat role mix before the engine can deadlock", () => {
    expect(() => createGame({
      gameId: "hunter-game",
      ruleset: {
        ...SIX_PLAYER_RULESET,
        roster: ["werewolf", "werewolf", "villager", "villager", "seer", "hunter"],
      },
      seed: "hunter-seed",
    })).toThrow("unsupported_ruleset");
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

  it.each([-1, 1.5, 11])("rejects invalid vote round version %s", (roundVersion) => {
    expect(() => assertGameState({
      ...makeState(),
      phase: "day_vote",
      vote: {
        kind: "exile",
        roundVersion,
        eligibleVoterSeats: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
        candidateSeats: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
        pendingBallots: [],
      },
    })).toThrow("invalid_vote_round_version");
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

  it("accepts a real night transition after the witch is killed", () => {
    const base = makeState();
    const state: GameState = {
      ...base,
      dayNumber: 0,
      phase: "night_witch_action",
      pendingEffects: [{ type: "wolf_kill", targetSeat: seat(4) }],
      night: {
        ...base.night,
        wolfSubmissions: [
          { actorSeat: seat(1), targetSeat: seat(4) },
          { actorSeat: seat(2), targetSeat: seat(4) },
        ],
        wolfTargetSeat: seat(4),
      },
    };

    const result = runFlowCommand(state, { type: "pass_action", actorSeat: seat(4) });

    expect(result.state.phase).toBe("dawn_last_words");
    expect(result.state.players.find((entry) => entry.seat === seat(4))?.alive).toBe(false);
  });

  it("accepts a real night transition after a historical wolf actor is poisoned", () => {
    const base = makeState();
    const state: GameState = {
      ...base,
      dayNumber: 0,
      phase: "night_witch_action",
      pendingEffects: [{ type: "wolf_kill", targetSeat: seat(6) }],
      night: {
        ...base.night,
        wolfSubmissions: [
          { actorSeat: seat(1), targetSeat: seat(6) },
          { actorSeat: seat(2), targetSeat: seat(6) },
        ],
        wolfTargetSeat: seat(6),
      },
    };

    const result = runFlowCommand(state, {
      type: "use_poison",
      actorSeat: seat(4),
      targetSeat: seat(1),
    });

    expect(result.state.phase).toBe("dawn_last_words");
    expect(result.state.players.find((entry) => entry.seat === seat(1))?.alive).toBe(false);
  });

  it("accepts a later self-destruct despite historical night submissions", () => {
    const base = makeState();
    const state: GameState = {
      ...base,
      phase: "day_speech",
      selfDestructEnabled: true,
      night: {
        ...base.night,
        wolfSubmissions: [{ actorSeat: seat(1), targetSeat: seat(3) }],
        submittedActorSeats: [seat(1)],
      },
      speech: {
        kind: "ordinary",
        eligibleSpeakerSeats: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
        speakingOrder: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
        submittedSpeakerSeats: [],
        limit: 220,
      },
    };

    const result = runFlowCommand(state, { type: "self_destruct", actorSeat: seat(1) });

    expect(result.state.phase).toBe("day_self_destruct_last_words");
    expect(result.state.players.find((entry) => entry.seat === seat(1))?.alive).toBe(false);
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
