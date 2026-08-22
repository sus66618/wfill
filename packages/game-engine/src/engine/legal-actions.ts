import type { GameCommand, SeatId } from "@wfill/contracts";
import type { GameState, PlayerState } from "../state/game-state.js";

export interface LegalAction {
  readonly type: GameCommand["type"];
  readonly targetRequired: boolean;
  readonly targetSeats: readonly SeatId[];
  readonly passAllowed: boolean;
  readonly speechLimit: number | null;
}

const action = (
  type: GameCommand["type"],
  targetSeats: readonly SeatId[] = [],
  passAllowed = false,
  speechLimit: number | null = null,
): LegalAction => ({
  type,
  targetRequired: targetSeats.length > 0,
  targetSeats,
  passAllowed,
  speechLimit,
});

const hasSubmittedNightAction = (state: GameState, actorSeat: SeatId): boolean =>
  state.night.submittedActorSeats.includes(actorSeat);

const aliveTargetsExcept = (state: GameState, actorSeat: SeatId): SeatId[] =>
  state.players
    .filter((player) => player.alive && player.seat !== actorSeat)
    .map((player) => player.seat);

const legalWolfTargets = (state: GameState): SeatId[] => state.players
  .filter((player) => player.alive && player.roleId !== "werewolf")
  .map((player) => player.seat);

const passAction = (): LegalAction => action("pass_action", [], true);

const witchActions = (state: GameState, actor: PlayerState): LegalAction[] => {
  const resources = actor.privateState.witchResources;
  if (resources === undefined || state.night.potionUsed) {
    return [passAction()];
  }

  const actions: LegalAction[] = [];
  if (
    resources.antidoteAvailable
    && state.night.wolfTargetSeat !== undefined
    && state.night.wolfTargetSeat !== null
    && state.night.wolfTargetSeat !== actor.seat
  ) {
    actions.push(action("use_antidote", [], true));
  }
  if (resources.poisonAvailable) {
    actions.push(action("use_poison", aliveTargetsExcept(state, actor.seat), true));
  }
  actions.push(passAction());
  return actions;
};

const speechActions = (state: GameState, actor: PlayerState): LegalAction[] => {
  const actions: LegalAction[] = [];
  const speech = state.speech;
  const currentSpeaker = speech?.speakingOrder
    .find((seat) => !speech.submittedSpeakerSeats.includes(seat));

  if (
    speech !== undefined
    && speech !== null
    && speech.eligibleSpeakerSeats.includes(actor.seat)
    && currentSpeaker === actor.seat
  ) {
    actions.push(action("submit_speech", [], false, speech.limit));
  }

  if (
    state.phase === "day_speech"
    && actor.roleId === "werewolf"
    && state.selfDestructEnabled !== false
  ) {
    actions.push(action("self_destruct"));
  }
  return actions;
};

const isCurrentLastWordsSpeaker = (state: GameState, actorSeat: SeatId): boolean => {
  if (
    state.phase !== "dawn_last_words"
    && state.phase !== "day_exile_last_words"
    && state.phase !== "day_self_destruct_last_words"
  ) return false;

  const speech = state.speech;
  if (speech === undefined || speech === null || speech.kind !== "last_words") return false;
  return speech.eligibleSpeakerSeats.includes(actorSeat)
    && speech.speakingOrder.find((seat) => !speech.submittedSpeakerSeats.includes(seat)) === actorSeat;
};

export const isLegalVoteTarget = (
  state: GameState,
  actorSeat: SeatId,
  targetSeat: SeatId,
): boolean => actorSeat !== targetSeat
  && state.vote?.candidateSeats.includes(targetSeat) === true
  && state.players.some((player) => player.seat === targetSeat && player.alive);

const voteActions = (state: GameState, actor: PlayerState): LegalAction[] => {
  const vote = state.vote;
  if (
    vote === undefined
    || vote === null
    || !vote.eligibleVoterSeats.includes(actor.seat)
    || vote.pendingBallots.some((ballot) => ballot.actorSeat === actor.seat)
  ) {
    return [];
  }

  const targetSeats = vote.candidateSeats
    .filter((targetSeat) => isLegalVoteTarget(state, actor.seat, targetSeat));
  return targetSeats.length > 0
    ? [action("submit_vote", targetSeats, true), passAction()]
    : [passAction()];
};

export const getLegalActions = (state: GameState, actorSeat: SeatId): LegalAction[] => {
  const actor = state.players.find((player) => player.seat === actorSeat);
  if (actor === undefined || (!actor.alive && !isCurrentLastWordsSpeaker(state, actorSeat))) return [];

  if (state.phase === "night_wolf_discussion" || state.phase === "night_wolf_final_confirmation") {
    if (actor.roleId !== "werewolf" || hasSubmittedNightAction(state, actorSeat)) return [];
    return [action("submit_wolf_kill", legalWolfTargets(state), true), passAction()];
  }
  if (state.phase === "night_seer_action") {
    if (actor.roleId !== "seer" || hasSubmittedNightAction(state, actorSeat)) return [];
    return [action("inspect_player", aliveTargetsExcept(state, actor.seat), true), passAction()];
  }
  if (state.phase === "night_witch_action") {
    if (actor.roleId !== "witch" || hasSubmittedNightAction(state, actorSeat)) return [];
    return witchActions(state, actor);
  }
  if (
    state.phase === "day_speech"
    || state.phase === "day_pk_speech"
    || state.phase === "day_exile_last_words"
    || state.phase === "dawn_last_words"
    || state.phase === "day_self_destruct_last_words"
  ) {
    return speechActions(state, actor);
  }
  if (state.phase === "day_vote" || state.phase === "day_pk_vote") {
    return voteActions(state, actor);
  }
  return [];
};

export const legalActionForCommand = (
  state: GameState,
  command: GameCommand,
): LegalAction | undefined => getLegalActions(state, command.actorSeat)
  .find((legalAction) => legalAction.type === command.type);
