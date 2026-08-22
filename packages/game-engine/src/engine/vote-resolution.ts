import type { SeatId } from "@wfill/contracts";
import type {
  GameState,
  VoteBallot,
  VoteTallyEntry,
} from "../state/game-state.js";

interface VoteResolutionBase {
  readonly ballots: readonly VoteBallot[];
  readonly tally: readonly VoteTallyEntry[];
}

export type VoteResolution =
  | { readonly kind: "pending" }
  | (VoteResolutionBase & {
    readonly kind: "exile";
    readonly exiledSeat: SeatId;
  })
  | (VoteResolutionBase & {
    readonly kind: "open_pk";
    readonly tiedCandidateSeats: readonly SeatId[];
  })
  | (VoteResolutionBase & {
    readonly kind: "no_exile";
    readonly tiedCandidateSeats: readonly SeatId[];
  });

const hasAllEligibleBallots = (state: GameState): boolean => {
  const vote = state.vote;
  if (vote === undefined || vote === null) return false;
  const submittedSeats = new Set(vote.pendingBallots.map((ballot) => ballot.actorSeat));
  return vote.pendingBallots.length === vote.eligibleVoterSeats.length
    && submittedSeats.size === vote.pendingBallots.length
    && vote.pendingBallots.every((ballot) => vote.eligibleVoterSeats.includes(ballot.actorSeat))
    && vote.eligibleVoterSeats.every((seat) => submittedSeats.has(seat));
};

export const resolveVoteRound = (state: GameState): VoteResolution => {
  const vote = state.vote;
  if (vote === undefined || vote === null || !hasAllEligibleBallots(state)) {
    return { kind: "pending" };
  }

  const tally = vote.candidateSeats.map((targetSeat) => ({
    targetSeat,
    votes: vote.pendingBallots.filter((ballot) => ballot.targetSeat === targetSeat).length,
  }));
  const highestVotes = Math.max(0, ...tally.map((entry) => entry.votes));
  const tiedCandidateSeats = tally
    .filter((entry) => entry.votes === highestVotes)
    .map((entry) => entry.targetSeat);
  const base = { ballots: vote.pendingBallots, tally };

  if (tiedCandidateSeats.length === 1) {
    return { ...base, kind: "exile", exiledSeat: tiedCandidateSeats[0]! };
  }
  if (vote.kind === "exile") {
    return { ...base, kind: "open_pk", tiedCandidateSeats };
  }
  return { ...base, kind: "no_exile", tiedCandidateSeats };
};
