import { describe, expect, it } from "vitest";
import type { GameId, SeatId } from "@wfill/contracts";
import { getLegalActions } from "../src/index.js";
import type { GamePhase, GameState, PlayerState } from "../src/index.js";

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

const players = (): readonly PlayerState[] => [
  player(1, "werewolf"),
  player(2, "werewolf"),
  player(3, "villager"),
  player(4, "witch"),
  player(5, "seer"),
  player(6, "villager"),
];

const makeState = (phase: GamePhase, overrides: Partial<GameState> = {}): GameState => ({
  gameId: "legal-actions" as GameId,
  rulesetId: "six-player-classic-no-sheriff",
  rulesetVersion: "1.0.0",
  version: 10,
  phase,
  outcome: "ongoing",
  players: players(),
  pendingEffects: [],
  processedCommandIds: [],
  night: {
    wolfConfirmationRound: 1,
    wolfSubmissions: [],
    submittedActorSeats: [],
    potionUsed: false,
  },
  speech: null,
  vote: null,
  ...overrides,
});

describe("legal action snapshots", () => {
  it("never offers dead players speech or vote actions", () => {
    const deadPlayers = players().map((entry) => entry.seat === seat(3)
      ? { ...entry, alive: false }
      : entry);
    const state = makeState("day_speech", {
      players: deadPlayers,
      speech: {
        kind: "ordinary",
        eligibleSpeakerSeats: [seat(3)],
        speakingOrder: [seat(3)],
        submittedSpeakerSeats: [],
        limit: 220,
      },
    });

    expect(getLegalActions(state, seat(3))).toEqual([]);
  });

  it("offers the witch only unused and currently legal potion actions", () => {
    const witchPlayers = players().map((entry) => entry.roleId === "witch"
      ? {
          ...entry,
          privateState: {
            ...entry.privateState,
            witchResources: { antidoteAvailable: false, poisonAvailable: true },
          },
        }
      : entry);
    const state = makeState("night_witch_action", {
      players: witchPlayers,
      night: {
        wolfConfirmationRound: 1,
        wolfSubmissions: [],
        submittedActorSeats: [],
        wolfTargetSeat: seat(3),
        potionUsed: false,
      },
    });

    expect(getLegalActions(state, seat(4))).toEqual([
      {
        type: "use_poison",
        targetRequired: true,
        targetSeats: [seat(1), seat(2), seat(3), seat(5), seat(6)],
        passAllowed: true,
        speechLimit: null,
      },
      {
        type: "pass_action",
        targetRequired: false,
        targetSeats: [],
        passAllowed: true,
        speechLimit: null,
      },
    ]);
  });

  it("describes the current speech turn with its frozen limit", () => {
    const state = makeState("day_speech", {
      speech: {
        kind: "ordinary",
        eligibleSpeakerSeats: [seat(3), seat(4)],
        speakingOrder: [seat(3), seat(4)],
        submittedSpeakerSeats: [],
        limit: 180,
      },
    });

    expect(getLegalActions(state, seat(3))).toEqual([{
      type: "submit_speech",
      targetRequired: false,
      targetSeats: [],
      passAllowed: false,
      speechLimit: 180,
    }]);
    expect(getLegalActions(state, seat(4))).toEqual([]);
  });

  it.each([
    "dawn_last_words",
    "day_self_destruct_last_words",
    "day_exile_last_words",
  ] as const)("offers the current dead speaker last words during %s", (phase) => {
    const deadPlayers = players().map((entry) => entry.seat === seat(3)
      ? { ...entry, alive: false }
      : entry);
    const state = makeState(phase, {
      players: deadPlayers,
      speech: {
        kind: "last_words",
        eligibleSpeakerSeats: [seat(3)],
        speakingOrder: [seat(3)],
        submittedSpeakerSeats: [],
        limit: 150,
      },
    });

    expect(getLegalActions(state, seat(3))).toEqual([{
      type: "submit_speech",
      targetRequired: false,
      targetSeats: [],
      passAllowed: false,
      speechLimit: 150,
    }]);
  });

  it("describes vote targets and pass support without offering dead candidates", () => {
    const votePlayers = players().map((entry) => entry.seat === seat(6)
      ? { ...entry, alive: false }
      : entry);
    const state = makeState("day_vote", {
      players: votePlayers,
      vote: {
        kind: "exile",
        roundVersion: 10,
        eligibleVoterSeats: [seat(1), seat(2), seat(3), seat(4), seat(5)],
        candidateSeats: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
        pendingBallots: [],
      },
    });

    expect(getLegalActions(state, seat(3))).toEqual([
      {
        type: "submit_vote",
        targetRequired: true,
        targetSeats: [seat(1), seat(2), seat(4), seat(5)],
        passAllowed: true,
        speechLimit: null,
      },
      {
        type: "pass_action",
        targetRequired: false,
        targetSeats: [],
        passAllowed: true,
        speechLimit: null,
      },
    ]);
  });

  it("offers only pass when every vote candidate is self or dead", () => {
    const votePlayers = players().map((entry) => entry.seat === seat(6)
      ? { ...entry, alive: false }
      : entry);
    const state = makeState("day_vote", {
      players: votePlayers,
      vote: {
        kind: "exile",
        roundVersion: 10,
        eligibleVoterSeats: [seat(3)],
        candidateSeats: [seat(3), seat(6)],
        pendingBallots: [],
      },
    });

    expect(getLegalActions(state, seat(3))).toEqual([{
      type: "pass_action",
      targetRequired: false,
      targetSeats: [],
      passAllowed: true,
      speechLimit: null,
    }]);
  });

  it("offers a live wolf self-destruct only during the enabled day speech window", () => {
    const state = makeState("day_speech", {
      selfDestructEnabled: true,
      speech: {
        kind: "ordinary",
        eligibleSpeakerSeats: [seat(3)],
        speakingOrder: [seat(3)],
        submittedSpeakerSeats: [],
        limit: 220,
      },
    });

    expect(getLegalActions(state, seat(1))).toEqual([{
      type: "self_destruct",
      targetRequired: false,
      targetSeats: [],
      passAllowed: false,
      speechLimit: null,
    }]);
    expect(getLegalActions({ ...state, phase: "day_vote" }, seat(1))).toEqual([]);
  });
});
