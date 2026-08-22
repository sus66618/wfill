import type { SeatId } from "@wfill/contracts";
import type { GamePhase, GameState, PlayerState } from "../state/game-state.js";

const VALID_PHASES = new Set<GamePhase>([
  "night_wolf_discussion",
  "night_wolf_final_confirmation",
  "night_seer_action",
  "night_witch_action",
  "dawn",
  "dawn_last_words",
  "day_speech",
  "day_vote",
  "day_pk_speech",
  "day_pk_vote",
  "day_exile_last_words",
  "day_self_destruct_last_words",
  "settlement",
]);

const invariantFailure = (reason: string): never => {
  throw new Error(reason);
};

const assertNonnegativeResources = (state: GameState): void => {
  const resources = [
    state.dayNumber,
    state.speech?.limit,
    state.vote?.roundVersion,
    state.speechLimits?.wolfDiscussion.maxMessagesPerWolf,
    state.speechLimits?.wolfDiscussion.maxCharacters,
    state.speechLimits?.ordinary.recommendedMinCharacters,
    state.speechLimits?.ordinary.recommendedMaxCharacters,
    state.speechLimits?.ordinary.maxCharacters,
    state.speechLimits?.pk.maxCharacters,
    state.speechLimits?.lastWords.firstNightMaxCharacters,
    state.speechLimits?.lastWords.dayExileMaxCharacters,
    state.speechLimits?.lastWords.selfDestructMaxCharacters,
    state.speechLimits?.abilityQuote.maxCharacters,
  ];
  if (resources.some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) {
    invariantFailure("negative_resource");
  }
};

const actorFor = (players: readonly PlayerState[], actorSeat: SeatId): PlayerState => {
  const actor = players.find((player) => player.seat === actorSeat);
  return actor ?? invariantFailure("actor_not_found");
};

const assertLivingActors = (state: GameState): void => {
  const actorSeats: SeatId[] = [
    ...state.night.submittedActorSeats,
    ...state.night.wolfSubmissions.map((submission) => submission.actorSeat),
    ...(state.vote?.pendingBallots.map((ballot) => ballot.actorSeat) ?? []),
    ...state.pendingEffects.flatMap((effect) => "actorSeat" in effect ? [effect.actorSeat] : []),
    ...(state.speech !== undefined && state.speech !== null && state.speech.kind !== "last_words"
      ? state.speech.submittedSpeakerSeats
      : []),
  ];

  for (const actorSeat of actorSeats) {
    if (!actorFor(state.players, actorSeat).alive) invariantFailure("dead_actor");
  }
};

export const assertGameState = (state: GameState, previousVersion?: number): void => {
  if (state.players.length !== 6) invariantFailure("exact_six_seats");

  const seatNumbers = state.players.map((player) => Number(player.seat));
  if (new Set(seatNumbers).size !== seatNumbers.length) invariantFailure("duplicate_seat");
  if (!seatNumbers.every((seatNumber) => Number.isInteger(seatNumber) && seatNumber >= 1 && seatNumber <= 6)) {
    invariantFailure("invalid_seat");
  }

  if (!Number.isInteger(state.version) || state.version < 0) invariantFailure("invalid_version");
  if (previousVersion !== undefined && state.version <= previousVersion) {
    invariantFailure("non_monotonic_version");
  }
  if (!VALID_PHASES.has(state.phase)) invariantFailure("invalid_phase");

  assertNonnegativeResources(state);
  assertLivingActors(state);

  if (new Set(state.processedCommandIds).size !== state.processedCommandIds.length) {
    invariantFailure("duplicate_command_id");
  }
};
