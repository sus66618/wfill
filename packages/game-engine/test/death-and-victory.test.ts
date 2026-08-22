import { describe, expect, it } from "vitest";
import {
  GameEventSchema,
  type CommandId,
  type GameCommand,
  type GameId,
  type SeatId,
} from "@wfill/contracts";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import {
  applyCommand,
  evaluateVictory,
  lastWordsEligibility,
  resolveDeaths,
} from "../src/index.js";
import type { GamePhase, GameState, PlayerState } from "../src/index.js";

const seat = (value: number): SeatId => value as SeatId;

const player = (seatNumber: number, roleId: string, alive = true): PlayerState => ({
  seat: seat(seatNumber),
  roleId,
  alive,
  privateState: {
    wolfTeammateSeats: roleId === "werewolf" ? [seat(seatNumber === 1 ? 2 : 1)] : [],
  },
});

const makeState = (
  phase: GamePhase = "day_speech",
  players: readonly PlayerState[] = [
    player(1, "werewolf"),
    player(2, "werewolf"),
    player(3, "villager"),
    player(4, "witch"),
    player(5, "seer"),
    player(6, "villager"),
  ],
): GameState => ({
  gameId: "game-settlement" as GameId,
  rulesetId: SIX_PLAYER_RULESET.id,
  rulesetVersion: SIX_PLAYER_RULESET.version,
  speechLimits: SIX_PLAYER_RULESET.speechLimits,
  selfDestructEnabled: SIX_PLAYER_RULESET.selfDestruct.enabled,
  dayNumber: 1,
  lastNightEliminatedSeats: [],
  version: 10,
  phase,
  outcome: "ongoing",
  players,
  pendingEffects: [],
  processedCommandIds: [],
  night: {
    wolfConfirmationRound: 1,
    wolfSubmissions: [],
    submittedActorSeats: [],
    potionUsed: false,
  },
  speech: phase === "day_speech"
    ? {
        kind: "ordinary",
        eligibleSpeakerSeats: players.filter((entry) => entry.alive).map((entry) => entry.seat),
        speakingOrder: players.filter((entry) => entry.alive).map((entry) => entry.seat),
        submittedSpeakerSeats: [],
        limit: 220,
      }
    : null,
  vote: null,
  publicVoteResult: null,
  pendingExileSeat: null,
});

let commandIndex = 0;
const runCommand = (
  state: GameState,
  input: Omit<GameCommand, "commandId" | "gameId" | "expectedVersion">,
) => {
  commandIndex += 1;
  return applyCommand(state, {
    ...input,
    commandId: `settlement-command-${commandIndex}` as CommandId,
    gameId: state.gameId,
    expectedVersion: state.version,
  } as GameCommand);
};

describe("death settlement and victory", () => {
  it("grants first-night and daytime last words but not later-night last words", () => {
    expect(lastWordsEligibility({
      dayNumber: 1,
      deathPhase: "night",
      ruleset: SIX_PLAYER_RULESET,
    })).toBe(true);
    expect(lastWordsEligibility({
      dayNumber: 2,
      deathPhase: "night",
      ruleset: SIX_PLAYER_RULESET,
    })).toBe(false);
    expect(lastWordsEligibility({
      dayNumber: 2,
      deathPhase: "day_exile",
      ruleset: SIX_PLAYER_RULESET,
    })).toBe(true);
    expect(lastWordsEligibility({
      dayNumber: 2,
      deathPhase: "self_destruct",
      ruleset: SIX_PLAYER_RULESET,
    })).toBe(true);
    expect(lastWordsEligibility({
      dayNumber: 2,
      deathPhase: "self_destruct",
      ruleset: { ...SIX_PLAYER_RULESET, selfDestruct: { enabled: false } },
    })).toBe(false);
  });

  it("applies antidote before deaths while poison still eliminates exactly once", () => {
    const state = makeState("night_witch_action");
    const resolution = resolveDeaths(state, [
      { type: "wolf_kill", targetSeat: seat(3) },
      { type: "antidote", actorSeat: seat(4) },
      { type: "poison", actorSeat: seat(4), targetSeat: seat(3) },
    ]);

    expect(resolution.eliminations).toEqual([{
      seat: seat(3),
      cause: "poison",
      deathPhase: "night",
      dayNumber: 2,
    }]);
    expect(resolution.state.players.find((entry) => entry.seat === seat(3))?.alive).toBe(false);
  });

  it.each([
    {
      name: "good wins when no wolf remains",
      players: [player(1, "werewolf", false), player(2, "villager")],
      status: "good_win",
    },
    {
      name: "wolves win when no good player remains",
      players: [player(1, "werewolf"), player(2, "villager", false)],
      status: "wolf_win",
    },
    {
      name: "play continues while both factions live",
      players: [player(1, "werewolf"), player(2, "villager")],
      status: "ongoing",
    },
  ])("returns $name", ({ players, status }) => {
    expect(evaluateVictory(makeState("settlement", players))).toMatchObject({ status });
  });

  it("allows an ordinary wolf to self-destruct before voting without taking another player", () => {
    const result = runCommand(makeState(), { type: "self_destruct", actorSeat: seat(1) });

    expect(result.state.players.find((entry) => entry.seat === seat(1))?.alive).toBe(false);
    expect(result.state.players.filter((entry) => !entry.alive).map((entry) => entry.seat))
      .toEqual([seat(1)]);
    expect(result.state.phase).toBe("day_self_destruct_last_words");
    expect(result.state.speech).toMatchObject({
      kind: "last_words",
      eligibleSpeakerSeats: [seat(1)],
      speakingOrder: [seat(1)],
      limit: 30,
    });
    expect(result.events.at(-1)).toMatchObject({
      type: "player_eliminated",
      seat: seat(1),
      cause: "self_destruct",
      audience: { kind: "public" },
    });

    const tooLong = runCommand(result.state, {
      type: "submit_speech",
      actorSeat: seat(1),
      content: "遗".repeat(31),
    });
    expect(tooLong.events[0]).toMatchObject({
      type: "action_rejected",
      reason: "speech_too_long",
      audience: { kind: "private", seat: seat(1) },
    });

    const settled = runCommand(tooLong.state, {
      type: "submit_speech",
      actorSeat: seat(1),
      content: "遗".repeat(30),
    });
    expect(settled.state.phase).toBe("night_wolf_discussion");
    expect(settled.events.filter((event) => event.type === "player_eliminated")).toEqual([]);
  });

  it("rejects self-destruct after voting opens", () => {
    const state: GameState = {
      ...makeState("day_vote"),
      speech: null,
      vote: {
        kind: "exile",
        roundVersion: 10,
        eligibleVoterSeats: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
        candidateSeats: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
        pendingBallots: [],
      },
    };
    const result = runCommand(state, { type: "self_destruct", actorSeat: seat(1) });

    expect(result.events.at(-1)).toMatchObject({
      type: "action_rejected",
      reason: "action_window_closed",
      audience: { kind: "private", seat: seat(1) },
    });
    expect(result.state.players.find((entry) => entry.seat === seat(1))?.alive).toBe(true);
  });

  it("rejects self-destruct from a good player", () => {
    const result = runCommand(makeState(), { type: "self_destruct", actorSeat: seat(3) });

    expect(result.events.at(-1)).toMatchObject({
      type: "action_rejected",
      reason: "role_ability_forbidden",
      audience: { kind: "private", seat: seat(3) },
    });
  });

  it("settles victory immediately when the last wolf self-destructs", () => {
    const state = makeState("day_speech", [
      player(1, "werewolf"),
      player(2, "werewolf", false),
      player(3, "villager"),
    ]);
    const result = runCommand(state, { type: "self_destruct", actorSeat: seat(1) });

    expect(result.state.phase).toBe("settlement");
    expect(result.state.outcome).toBe("good_win");
    expect(result.state.speech).toBeNull();
    expect(result.events.map((event) => event.type)).toEqual([
      "player_eliminated",
      "game_finished",
    ]);
    expect(result.events.at(-1)).toMatchObject({
      type: "game_finished",
      winner: "good",
      audience: { kind: "public" },
    });
  });

  it("rejects every new action after victory settlement", () => {
    const state: GameState = {
      ...makeState("settlement", [player(1, "werewolf"), player(2, "villager", false)]),
      outcome: "wolf_win",
      speech: null,
    };
    const result = runCommand(state, { type: "pass_action", actorSeat: seat(1) });

    expect(result.events.at(-1)).toMatchObject({
      type: "action_rejected",
      reason: "action_window_closed",
      audience: { kind: "private", seat: seat(1) },
    });
    expect(result.state.phase).toBe("settlement");
    expect(result.state.outcome).toBe("wolf_win");
  });

  it("eliminates an exiled player after last words and checks victory before night", () => {
    const players = [
      player(1, "werewolf"),
      player(2, "werewolf", false),
      player(3, "villager"),
    ];
    const state: GameState = {
      ...makeState("day_exile_last_words", players),
      pendingExileSeat: seat(1),
      speech: {
        kind: "last_words",
        eligibleSpeakerSeats: [seat(1)],
        speakingOrder: [seat(1)],
        submittedSpeakerSeats: [],
        limit: 150,
      },
    };
    const result = runCommand(state, {
      type: "submit_speech",
      actorSeat: seat(1),
      content: "我认出局。",
    });

    expect(result.state.players.find((entry) => entry.seat === seat(1))?.alive).toBe(false);
    expect(result.state.pendingExileSeat).toBeNull();
    expect(result.state.phase).toBe("settlement");
    expect(result.state.outcome).toBe("good_win");
    expect(result.events.map((event) => event.type)).toEqual([
      "speech_published",
      "player_eliminated",
      "game_finished",
    ]);
    expect(result.events[1]).toMatchObject({ cause: "exile", audience: { kind: "public" } });
  });

  it("opens first-night last words for eliminated players and accepts their dead-actor speech", () => {
    let state = makeState("night_wolf_discussion", [
      player(1, "werewolf"),
      player(2, "werewolf"),
      player(3, "villager"),
      player(4, "villager"),
      player(5, "seer", false),
      player(6, "witch", false),
    ]);
    state = { ...state, dayNumber: 0, speech: null };

    state = runCommand(state, {
      type: "submit_wolf_kill",
      actorSeat: seat(1),
      targetSeat: seat(3),
    }).state;
    const killed = runCommand(state, {
      type: "submit_wolf_kill",
      actorSeat: seat(2),
      targetSeat: seat(3),
    });

    expect(killed.state.phase).toBe("dawn_last_words");
    expect(killed.state.lastNightEliminatedSeats).toEqual([seat(3)]);
    expect(killed.state.players.find((entry) => entry.seat === seat(3))?.alive).toBe(false);
    expect(killed.state.speech).toMatchObject({
      eligibleSpeakerSeats: [seat(3)],
      limit: 150,
    });
    expect(killed.events).toContainEqual(expect.objectContaining({
      type: "player_eliminated",
      seat: seat(3),
      cause: "wolf_kill",
      audience: { kind: "public" },
    }));

    const lastWords = runCommand(killed.state, {
      type: "submit_speech",
      actorSeat: seat(3),
      content: "首夜遗言。",
    });
    expect(lastWords.state.phase).toBe("day_speech");
  });

  it("skips later-night last words", () => {
    let state = makeState("night_wolf_discussion", [
      player(1, "werewolf"),
      player(2, "werewolf"),
      player(3, "villager"),
      player(4, "villager"),
      player(5, "seer", false),
      player(6, "witch", false),
    ]);
    state = { ...state, dayNumber: 1, speech: null };

    state = runCommand(state, {
      type: "submit_wolf_kill",
      actorSeat: seat(1),
      targetSeat: seat(3),
    }).state;
    const killed = runCommand(state, {
      type: "submit_wolf_kill",
      actorSeat: seat(2),
      targetSeat: seat(3),
    });

    expect(killed.state.phase).toBe("day_speech");
    expect(killed.state.dayNumber).toBe(2);
    expect(killed.state.lastNightEliminatedSeats).toEqual([seat(3)]);
    expect(killed.state.speech?.eligibleSpeakerSeats).not.toContain(seat(3));
  });

  it("forces elimination and victory events to a public audience", () => {
    const envelope = {
      eventId: "event-death",
      gameId: "game-settlement",
      version: 11,
      type: "player_eliminated",
      seat: 3,
      cause: "poison",
    };

    expect(GameEventSchema.safeParse({
      ...envelope,
      audience: { kind: "private", seat: 3 },
    }).success).toBe(false);
    expect(GameEventSchema.parse({
      ...envelope,
      audience: { kind: "public" },
    })).toMatchObject(envelope);
  });
});
