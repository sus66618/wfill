import { describe, expect, it } from "vitest";
import type { CommandId, GameCommand, GameId, SeatId } from "@wfill/contracts";
import {
  applyCommand,
  resolveVoteRound,
} from "../src/index.js";
import type {
  GameState,
  PlayerState,
  VoteRoundState,
} from "../src/index.js";

const seat = (value: number): SeatId => value as SeatId;

const player = (seatNumber: number): PlayerState => ({
  seat: seat(seatNumber),
  roleId: "villager",
  alive: true,
  privateState: { wolfTeammateSeats: [] },
});

const exileRound = (): VoteRoundState => ({
  kind: "exile",
  roundVersion: 10,
  eligibleVoterSeats: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
  candidateSeats: [seat(2), seat(3), seat(4)],
  pendingBallots: [],
});

const openVoteState = (): GameState => ({
  gameId: "game-day" as GameId,
  rulesetId: "six-player-classic-no-sheriff",
  rulesetVersion: "1.0.0",
  version: 10,
  phase: "day_vote",
  players: [1, 2, 3, 4, 5, 6].map(player),
  pendingEffects: [],
  processedCommandIds: [],
  night: {
    wolfConfirmationRound: 1,
    wolfSubmissions: [],
    submittedActorSeats: [],
    potionUsed: false,
  },
  speech: null,
  vote: exileRound(),
  publicVoteResult: null,
});

let commandIndex = 0;
const runCommand = (
  state: GameState,
  input: Omit<GameCommand, "commandId" | "gameId" | "expectedVersion">,
) => applyCommand(state, {
  ...input,
  commandId: `day-command-${commandIndex += 1}` as CommandId,
  gameId: state.gameId,
  expectedVersion: state.version,
} as GameCommand);

const runCommandAtVersion = (
  state: GameState,
  input: Omit<GameCommand, "commandId" | "gameId" | "expectedVersion">,
  expectedVersion: number,
) => applyCommand(state, {
  ...input,
  commandId: `day-command-${commandIndex += 1}` as CommandId,
  gameId: state.gameId,
  expectedVersion,
} as GameCommand);

const finishFirstTie = (): ReturnType<typeof applyCommand> => {
  let state = openVoteState();
  const roundVersion = state.vote!.roundVersion;
  let result = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(1), targetSeat: seat(2) }, roundVersion);
  state = result.state;
  result = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(2), targetSeat: seat(3) }, roundVersion);
  state = result.state;
  result = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(3), targetSeat: seat(2) }, roundVersion);
  state = result.state;
  result = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(4), targetSeat: seat(3) }, roundVersion);
  state = result.state;
  result = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(5), targetSeat: seat(4) }, roundVersion);
  state = result.state;
  return runCommandAtVersion(state, { type: "pass_action", actorSeat: seat(6) }, roundVersion);
};

describe("day voting", () => {
  it("accepts every simultaneous ballot against one frozen round version", () => {
    let state = openVoteState();
    const inputs = [
      { type: "submit_vote", actorSeat: seat(1), targetSeat: seat(2) },
      { type: "submit_vote", actorSeat: seat(2), targetSeat: seat(3) },
      { type: "submit_vote", actorSeat: seat(3), targetSeat: seat(2) },
      { type: "submit_vote", actorSeat: seat(4), targetSeat: seat(3) },
      { type: "submit_vote", actorSeat: seat(5), targetSeat: seat(4) },
      { type: "pass_action", actorSeat: seat(6) },
    ] as const;

    for (const input of inputs) {
      const result = runCommandAtVersion(state, input, 10);
      expect(result.events[0]).toMatchObject({ type: "vote_accepted" });
      state = result.state;
    }

    expect(state.publicVoteResult?.ballots).toHaveLength(6);
    expect(state.vote).toMatchObject({ kind: "pk" });
    expect(state.vote!.roundVersion).toBeLessThan(state.version);
  });

  it("rejects a ballot that substitutes the mutable state version for the round version", () => {
    const first = runCommandAtVersion(openVoteState(), {
      type: "submit_vote",
      actorSeat: seat(1),
      targetSeat: seat(2),
    }, 10);
    const result = runCommandAtVersion(first.state, {
      type: "submit_vote",
      actorSeat: seat(2),
      targetSeat: seat(3),
    }, first.state.version);

    expect(first.state.version).toBe(11);
    expect(result.events[0]).toMatchObject({
      type: "action_rejected",
      reason: "version_conflict",
    });
    expect(result.state.vote?.pendingBallots).toEqual([
      { actorSeat: seat(1), targetSeat: seat(2) },
    ]);
  });

  it("keeps non-vote commands on the current state version during voting", () => {
    const first = runCommandAtVersion(openVoteState(), {
      type: "submit_vote",
      actorSeat: seat(1),
      targetSeat: seat(2),
    }, 10);
    const staleSpeech = runCommandAtVersion(first.state, {
      type: "submit_speech",
      actorSeat: seat(2),
      content: "这不是投票命令。",
    }, 10);
    const currentSpeech = runCommandAtVersion(first.state, {
      type: "submit_speech",
      actorSeat: seat(2),
      content: "这仍然不是投票命令。",
    }, first.state.version);

    expect(staleSpeech.events[0]).toMatchObject({
      type: "action_rejected",
      reason: "version_conflict",
    });
    expect(currentSpeech.events[0]).toMatchObject({
      type: "action_rejected",
      reason: "action_window_closed",
    });
  });

  it("does not expose pending ballots before the round closes", () => {
    const result = runCommand(openVoteState(), {
      type: "submit_vote",
      actorSeat: seat(1),
      targetSeat: seat(3),
    });

    expect(result.state.publicVoteResult).toBeNull();
    expect(result.state.vote).toMatchObject({
      roundVersion: 10,
      eligibleVoterSeats: [seat(1), seat(2), seat(3), seat(4), seat(5), seat(6)],
      candidateSeats: [seat(2), seat(3), seat(4)],
    });
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "vote_accepted",
        actorSeat: seat(1),
        targetSeat: seat(3),
        audience: { kind: "private", seat: seat(1) },
      }),
    ]);
    expect(result.events.some((event) => event.audience.kind === "public")).toBe(false);
  });

  it("rejects ineligible voters and targets without changing the frozen round", () => {
    const state = openVoteState();
    const ineligible = runCommand({
      ...state,
      vote: { ...exileRound(), eligibleVoterSeats: [seat(1)] },
    }, {
      type: "submit_vote",
      actorSeat: seat(2),
      targetSeat: seat(3),
    });
    const illegalTarget = runCommand(state, {
      type: "submit_vote",
      actorSeat: seat(1),
      targetSeat: seat(6),
    });

    expect(ineligible.events[0]).toMatchObject({ type: "action_rejected", reason: "voter_not_eligible" });
    expect(illegalTarget.events[0]).toMatchObject({ type: "action_rejected", reason: "illegal_target" });
    expect(ineligible.state.vote?.pendingBallots).toEqual([]);
    expect(illegalTarget.state.vote?.pendingBallots).toEqual([]);
  });

  it("rejects self-votes and dead targets through the same legal-target contract", () => {
    const state = openVoteState();
    const selfVote = runCommand(state, {
      type: "submit_vote",
      actorSeat: seat(2),
      targetSeat: seat(2),
    });
    const deadTarget = runCommand({
      ...state,
      players: state.players.map((entry) => entry.seat === seat(3)
        ? { ...entry, alive: false }
        : entry),
    }, {
      type: "submit_vote",
      actorSeat: seat(1),
      targetSeat: seat(3),
    });

    expect(selfVote.events[0]).toMatchObject({ type: "action_rejected", reason: "illegal_target" });
    expect(deadTarget.events[0]).toMatchObject({ type: "action_rejected", reason: "illegal_target" });
    expect(selfVote.state.vote?.pendingBallots).toEqual([]);
    expect(deadTarget.state.vote?.pendingBallots).toEqual([]);
  });

  it("opens a PK round on first tie with only tied speakers and non-tied voters", () => {
    const result = finishFirstTie();

    expect(result.state.publicVoteResult).toMatchObject({
      roundKind: "exile",
      tally: [
        { targetSeat: seat(2), votes: 2 },
        { targetSeat: seat(3), votes: 2 },
        { targetSeat: seat(4), votes: 1 },
      ],
    });
    expect(result.state.phase).toBe("day_pk_speech");
    expect(result.state.speech).toMatchObject({
      kind: "pk",
      eligibleSpeakerSeats: [seat(2), seat(3)],
      speakingOrder: [seat(2), seat(3)],
    });
    expect(result.state.vote).toMatchObject({
      kind: "pk",
      eligibleVoterSeats: [seat(1), seat(4), seat(5), seat(6)],
      candidateSeats: [seat(2), seat(3)],
      pendingBallots: [],
    });
    expect(result.events.filter((event) => event.type === "vote_revealed")).toHaveLength(1);
    expect(result.events.filter((event) => event.type === "pk_round_opened")).toHaveLength(1);
    expect(result.events.filter((event) => event.type === "vote_revealed")[0])
      .toMatchObject({ audience: { kind: "public" } });
  });

  it("does not turn natural-language PK speech into a ballot", () => {
    let state = finishFirstTie().state;
    const firstSpeech = runCommand(state, {
      type: "submit_speech",
      actorSeat: seat(2),
      content: "我投三号，但这只是一句发言。",
    });
    state = firstSpeech.state;

    expect(state.vote?.pendingBallots).toEqual([]);
    expect(firstSpeech.events).toEqual([
      expect.objectContaining({
        type: "speech_published",
        seat: seat(2),
        content: "我投三号，但这只是一句发言。",
        audience: { kind: "public" },
      }),
    ]);

    const secondSpeech = runCommand(state, {
      type: "submit_speech",
      actorSeat: seat(3),
      content: "发言归发言，投票归 command。",
    });
    expect(secondSpeech.state.phase).toBe("day_pk_vote");
    expect(secondSpeech.state.vote?.pendingBallots).toEqual([]);
  });

  it("freezes a new PK vote version only after the final PK speech", () => {
    let state = finishFirstTie().state;
    const preSpeechVersion = state.vote!.roundVersion;
    state = runCommand(state, { type: "submit_speech", actorSeat: seat(2), content: "二号 PK 发言" }).state;
    state = runCommand(state, { type: "submit_speech", actorSeat: seat(3), content: "三号 PK 发言" }).state;

    expect(state.phase).toBe("day_pk_vote");
    expect(state.vote!.roundVersion).toBe(state.version);
    expect(state.vote!.roundVersion).not.toBe(preSpeechVersion);
    const stale = runCommandAtVersion(state, {
      type: "submit_vote",
      actorSeat: seat(1),
      targetSeat: seat(2),
    }, preSpeechVersion);
    expect(stale.events[0]).toMatchObject({ type: "action_rejected", reason: "version_conflict" });
  });

  it("publishes the complete PK result once and enters night on a second tie", () => {
    let state = finishFirstTie().state;
    state = runCommand(state, {
      type: "submit_speech",
      actorSeat: seat(2),
      content: "二号 PK 发言",
    }).state;
    state = runCommand(state, {
      type: "submit_speech",
      actorSeat: seat(3),
      content: "三号 PK 发言",
    }).state;
    const roundVersion = state.vote!.roundVersion;
    state = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(1), targetSeat: seat(2) }, roundVersion).state;
    state = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(4), targetSeat: seat(3) }, roundVersion).state;
    state = runCommandAtVersion(state, { type: "pass_action", actorSeat: seat(5) }, roundVersion).state;
    const result = runCommandAtVersion(state, { type: "pass_action", actorSeat: seat(6) }, roundVersion);

    expect(result.state.phase).toBe("night_wolf_discussion");
    expect(result.state.vote).toBeNull();
    expect(result.state.publicVoteResult).toMatchObject({
      roundKind: "pk",
      ballots: [
        { actorSeat: seat(1), targetSeat: seat(2) },
        { actorSeat: seat(4), targetSeat: seat(3) },
        { actorSeat: seat(5), targetSeat: null },
        { actorSeat: seat(6), targetSeat: null },
      ],
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "vote_accepted",
      "vote_revealed",
      "vote_tied_no_exile",
    ]);
    expect(result.events.slice(1).every((event) => event.audience.kind === "public")).toBe(true);
    expect(result.state.players.every((entry) => entry.alive)).toBe(true);
  });

  it("resolves first and second ties without consulting mutable player state", () => {
    const first = resolveVoteRound({
      ...openVoteState(),
      vote: {
        ...exileRound(),
        pendingBallots: [
          { actorSeat: seat(1), targetSeat: seat(2) },
          { actorSeat: seat(2), targetSeat: seat(3) },
          { actorSeat: seat(3), targetSeat: seat(2) },
          { actorSeat: seat(4), targetSeat: seat(3) },
          { actorSeat: seat(5), targetSeat: null },
          { actorSeat: seat(6), targetSeat: null },
        ],
      },
    });
    const second = resolveVoteRound({
      ...openVoteState(),
      vote: {
        kind: "pk",
        roundVersion: 20,
        eligibleVoterSeats: [seat(1), seat(4)],
        candidateSeats: [seat(2), seat(3)],
        pendingBallots: [
          { actorSeat: seat(1), targetSeat: seat(2) },
          { actorSeat: seat(4), targetSeat: seat(3) },
        ],
      },
    });

    expect(first).toMatchObject({ kind: "open_pk", tiedCandidateSeats: [seat(2), seat(3)] });
    expect(second).toMatchObject({ kind: "no_exile", tiedCandidateSeats: [seat(2), seat(3)] });
  });

  it("does not treat duplicate ballots as a completed frozen round", () => {
    const result = resolveVoteRound({
      ...openVoteState(),
      vote: {
        ...exileRound(),
        eligibleVoterSeats: [seat(1), seat(2)],
        pendingBallots: [
          { actorSeat: seat(1), targetSeat: seat(2) },
          { actorSeat: seat(1), targetSeat: seat(3) },
          { actorSeat: seat(2), targetSeat: seat(3) },
        ],
      },
    });

    expect(result).toEqual({ kind: "pending" });
  });

  it("rejects a completed ballot set containing an out-of-candidate target", () => {
    expect(() => resolveVoteRound({
      ...openVoteState(),
      vote: {
        ...exileRound(),
        eligibleVoterSeats: [seat(1)],
        candidateSeats: [seat(2)],
        pendingBallots: [{ actorSeat: seat(1), targetSeat: seat(3) }],
      },
    })).toThrow("ballot_target_not_candidate");
  });

  it("closes an empty-voter PK after both tied candidates finish speaking", () => {
    let state: GameState = {
      ...openVoteState(),
      vote: {
        kind: "exile",
        roundVersion: 10,
        eligibleVoterSeats: [seat(2), seat(3)],
        candidateSeats: [seat(2), seat(3)],
        pendingBallots: [],
      },
    };
    const roundVersion = state.vote!.roundVersion;
    state = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(2), targetSeat: seat(3) }, roundVersion).state;
    state = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(3), targetSeat: seat(2) }, roundVersion).state;
    state = runCommand(state, { type: "submit_speech", actorSeat: seat(2), content: "二号发言" }).state;
    const result = runCommand(state, { type: "submit_speech", actorSeat: seat(3), content: "三号发言" });

    expect(result.state.phase).toBe("night_wolf_discussion");
    expect(result.state.vote).toBeNull();
    expect(result.events.map((event) => event.type)).toEqual([
      "speech_published",
      "vote_revealed",
      "vote_tied_no_exile",
    ]);
  });

  it("opens last words for a unique result and exiles only after that speech", () => {
    let state: GameState = {
      ...openVoteState(),
      vote: {
        ...exileRound(),
        eligibleVoterSeats: [seat(1), seat(2), seat(3)],
        candidateSeats: [seat(2), seat(3)],
      },
    };
    const roundVersion = state.vote!.roundVersion;
    state = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(1), targetSeat: seat(2) }, roundVersion).state;
    state = runCommandAtVersion(state, { type: "pass_action", actorSeat: seat(2) }, roundVersion).state;
    const result = runCommandAtVersion(state, { type: "submit_vote", actorSeat: seat(3), targetSeat: seat(2) }, roundVersion);

    expect(result.state.phase).toBe("day_exile_last_words");
    expect(result.state.pendingExileSeat).toBe(seat(2));
    expect(result.state.players.find((entry) => entry.seat === seat(2))?.alive).toBe(true);
    expect(result.events.at(-1)).toMatchObject({
      type: "exile_opened",
      exiledSeat: seat(2),
      audience: { kind: "public" },
    });

    const tooLong = runCommand(result.state, {
      type: "submit_speech",
      actorSeat: seat(2),
      content: "遗".repeat(151),
    });
    expect(tooLong.events[0]).toMatchObject({
      type: "action_rejected",
      reason: "speech_too_long",
      audience: { kind: "private", seat: seat(2) },
    });
    expect(tooLong.state.players.find((entry) => entry.seat === seat(2))?.alive).toBe(true);

    const settled = runCommand(tooLong.state, {
      type: "submit_speech",
      actorSeat: seat(2),
      content: "遗言结束。",
    });
    expect(settled.state.phase).toBe("settlement");
    expect(settled.state.pendingExileSeat).toBeNull();
    expect(settled.state.players.find((entry) => entry.seat === seat(2))?.alive).toBe(false);
    expect(settled.events.filter((event) => event.audience.kind === "public").slice(-2)).toEqual([
      expect.objectContaining({
        type: "player_eliminated",
        seat: seat(2),
        audience: { kind: "public" },
      }),
      expect.objectContaining({
        type: "game_finished",
        winner: "good",
        audience: { kind: "public" },
      }),
    ]);
  });
});
