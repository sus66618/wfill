import type {
  CommandId,
  EventId,
  GameCommand,
  GameEvent,
  SeatId,
} from "@wfill/contracts";
import { assertGameState } from "./assert-invariants.js";
import { legalActionForCommand } from "./legal-actions.js";
import {
  lastWordsEligibility,
  resolveDeaths,
  type Elimination,
} from "./death-resolution.js";
import { resolveNight } from "./night-resolution.js";
import { createSpeakingOrder, validateSpeech } from "./speech-policy.js";
import { evaluateVictory } from "./victory.js";
import { resolveVoteRound } from "./vote-resolution.js";
import type {
  GameState,
  PendingEffect,
  PlayerState,
  PublicVoteResult,
  VoteRoundState,
  WolfSubmission,
} from "../state/game-state.js";

export interface ApplyCommandResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

type EventBody = Record<string, unknown> & { readonly type: GameEvent["type"] };

const eventIdFor = (state: GameState, version: number): EventId =>
  `${state.gameId}:${version}` as EventId;

const makeEvent = (state: GameState, offset: number, body: EventBody): GameEvent => {
  const version = state.version + offset;
  return {
    eventId: eventIdFor(state, version),
    gameId: state.gameId,
    version,
    ...body,
  } as GameEvent;
};

const withCommandRecord = (state: GameState, commandId: CommandId): GameState => ({
  ...state,
  processedCommandIds: state.processedCommandIds.includes(commandId)
    ? state.processedCommandIds
    : [...state.processedCommandIds, commandId],
});

const isVotePhase = (state: GameState): boolean =>
  state.phase === "day_vote" || state.phase === "day_pk_vote";

const isSpeechPhase = (state: GameState): boolean =>
  state.phase === "day_speech"
  || state.phase === "day_pk_speech"
  || state.phase === "day_exile_last_words"
  || state.phase === "dawn_last_words"
  || state.phase === "day_self_destruct_last_words";

const dayRejectionReason = (state: GameState, command: GameCommand): string | undefined => {
  if (isVotePhase(state)) {
    if (command.type !== "submit_vote" && command.type !== "pass_action") {
      return "action_window_closed";
    }
    const vote = state.vote;
    if (vote === undefined || vote === null) return "action_window_closed";
    if (!vote.eligibleVoterSeats.includes(command.actorSeat)) return "voter_not_eligible";
    if (vote.pendingBallots.some((ballot) => ballot.actorSeat === command.actorSeat)) {
      return "actor_already_submitted";
    }
    if (command.type === "submit_vote" && !vote.candidateSeats.includes(command.targetSeat)) {
      return "illegal_target";
    }
    return undefined;
  }

  if (isSpeechPhase(state)) {
    if (state.phase === "day_speech" && command.type === "self_destruct") {
      const actor = state.players.find((player) => player.seat === command.actorSeat);
      if (actor?.roleId !== "werewolf") return "role_ability_forbidden";
      if (state.selfDestructEnabled === false) return "self_destruct_disabled";
      return undefined;
    }
    if (command.type !== "submit_speech") return "action_window_closed";
    const speech = state.speech;
    if (speech === undefined || speech === null) return "action_window_closed";
    if (!speech.eligibleSpeakerSeats.includes(command.actorSeat)) return "speaker_not_eligible";
    if (speech.submittedSpeakerSeats.includes(command.actorSeat)) return "actor_already_submitted";
    const currentSpeaker = speech.speakingOrder
      .find((seat) => !speech.submittedSpeakerSeats.includes(seat));
    if (currentSpeaker !== command.actorSeat) return "speaker_out_of_order";
    const validation = validateSpeech(command.content, speech.limit);
    return validation.ok ? undefined : validation.reason;
  }

  return "action_window_closed";
};

const rejectionReason = (state: GameState, command: GameCommand): string | undefined => {
  if (state.gameId !== command.gameId) return "game_id_mismatch";
  const expectedVersion = isVotePhase(state)
    && (command.type === "submit_vote" || command.type === "pass_action")
    && state.vote !== undefined
    && state.vote !== null
    ? state.vote.roundVersion
    : state.version;
  if (expectedVersion !== command.expectedVersion) return "version_conflict";

  const actor = state.players.find((player) => player.seat === command.actorSeat);
  if (actor === undefined) return "actor_not_found";
  if (state.phase === "settlement" || (state.outcome !== undefined && state.outcome !== "ongoing")) {
    return "action_window_closed";
  }
  const isEligibleDeadLastWords = command.type === "submit_speech"
    && (state.phase === "dawn_last_words" || state.phase === "day_self_destruct_last_words")
    && state.speech?.eligibleSpeakerSeats.includes(command.actorSeat) === true;
  if (!actor.alive && !isEligibleDeadLastWords) return "actor_not_alive";

  if (isVotePhase(state) || isSpeechPhase(state) || state.phase === "dawn") {
    return dayRejectionReason(state, command);
  }

  const legalAction = legalActionForCommand(state, command);
  if (legalAction === undefined) {
    const correctWindow = (
      command.type === "submit_wolf_kill"
      && (state.phase === "night_wolf_discussion" || state.phase === "night_wolf_final_confirmation")
    ) || (command.type === "inspect_player" && state.phase === "night_seer_action")
      || ((command.type === "use_antidote" || command.type === "use_poison") && state.phase === "night_witch_action")
      || command.type === "pass_action";
    if (!correctWindow) return "action_window_closed";
    if (state.night.submittedActorSeats.includes(command.actorSeat)) return "actor_already_submitted";
    const requiredRole = command.type === "submit_wolf_kill"
      ? "werewolf"
      : command.type === "inspect_player"
        ? "seer"
        : command.type === "use_antidote" || command.type === "use_poison"
          ? "witch"
          : state.phase === "night_seer_action"
            ? "seer"
            : state.phase === "night_witch_action"
              ? "witch"
              : "werewolf";
    if (actor.roleId !== requiredRole) return "role_ability_forbidden";
    if (state.night.potionUsed && (command.type === "use_antidote" || command.type === "use_poison")) {
      return "one_potion_per_night";
    }
    if (
      command.type === "use_antidote"
      && state.night.wolfTargetSeat === command.actorSeat
    ) return "witch_self_save_forbidden";
    if (command.type === "use_antidote" || command.type === "use_poison") {
      const resource = command.type === "use_antidote" ? "antidoteAvailable" : "poisonAvailable";
      if (actor.privateState.witchResources?.[resource] === false) return "resource_unavailable";
    }
    if (
      command.type === "submit_wolf_kill"
      || command.type === "inspect_player"
      || command.type === "use_poison"
    ) return "illegal_target";
    return "role_ability_forbidden";
  }

  if (
    "targetSeats" in legalAction
    && "targetSeat" in command
    && !legalAction.targetSeats.includes(command.targetSeat)
  ) return "illegal_target";
  return undefined;
};

const rejected = (state: GameState, command: GameCommand, reason: string): ApplyCommandResult => {
  const event = makeEvent(state, 1, {
    type: "action_rejected",
    commandId: command.commandId,
    reason,
    actorSeat: command.actorSeat,
    audience: { kind: "private", seat: command.actorSeat },
  });
  return {
    state: {
      ...withCommandRecord(state, command.commandId),
      version: event.version,
    },
    events: [event],
  };
};

const aliveRolePlayers = (state: GameState, roleId: string): PlayerState[] =>
  state.players.filter((player) => player.alive && player.roleId === roleId);

const eliminationBodies = (eliminations: readonly Elimination[]): EventBody[] =>
  eliminations.map((elimination) => ({
    type: "player_eliminated",
    seat: elimination.seat,
    cause: elimination.cause,
    audience: { kind: "public" },
  }));

const completeDeathSettlement = (
  state: GameState,
  eliminations: readonly Elimination[],
  initialBodies: readonly EventBody[],
  continueWith: (settledState: GameState) => GameState,
): { readonly state: GameState; readonly bodies: readonly EventBody[] } => {
  const bodies = [...initialBodies, ...eliminationBodies(eliminations)];
  const victory = evaluateVictory(state);
  if (victory.status !== "ongoing") {
    return {
      state: {
        ...state,
        phase: "settlement",
        outcome: victory.status,
        pendingEffects: [],
        pendingExileSeat: null,
        speech: null,
        vote: null,
      },
      bodies: [
        ...bodies,
        {
          type: "game_finished",
          winner: victory.winner,
          audience: { kind: "public" },
        },
      ],
    };
  }

  return {
    state: { ...continueWith(state), outcome: "ongoing" },
    bodies,
  };
};

const actionRecordedBody = (command: GameCommand): EventBody => ({
  type: "night_action_recorded",
  actorSeat: command.actorSeat,
  action: command.type,
  audience: { kind: "private", seat: command.actorSeat },
});

const addEffect = (state: GameState, effect: PendingEffect): GameState => ({
  ...state,
  pendingEffects: [...state.pendingEffects, effect],
});

const submittedState = (state: GameState, command: GameCommand): GameState => ({
  ...withCommandRecord(state, command.commandId),
  night: {
    ...state.night,
    submittedActorSeats: [...state.night.submittedActorSeats, command.actorSeat],
  },
});

const wolfTargetFrom = (submissions: readonly WolfSubmission[]): SeatId | null => {
  const firstTarget = submissions[0]?.targetSeat ?? null;
  return submissions.every((submission) => submission.targetSeat === firstTarget)
    ? firstTarget
    : null;
};

const advanceAfterWolves = (state: GameState): GameState => {
  if (aliveRolePlayers(state, "seer").length > 0) {
    return {
      ...state,
      phase: "night_seer_action",
      night: { ...state.night, submittedActorSeats: [] },
    };
  }
  return {
    ...state,
    phase: "night_witch_action",
    night: { ...state.night, submittedActorSeats: [] },
  };
};

const resolvePendingNight = (
  state: GameState,
): { readonly state: GameState; readonly bodies: readonly EventBody[] } => {
  const inspectionBodies: EventBody[] = state.pendingEffects
    .filter((effect): effect is Extract<PendingEffect, { type: "inspection" }> => effect.type === "inspection")
    .map((effect) => {
      const target = state.players.find((player) => player.seat === effect.targetSeat)!;
      return {
        type: "inspection_result",
        actorSeat: effect.actorSeat,
        targetSeat: effect.targetSeat,
        faction: target.roleId === "werewolf" ? "werewolf" : "good",
        audience: { kind: "private", seat: effect.actorSeat },
      };
    });
  const resolution = resolveNight(state);
  const dayNumber = (state.dayNumber ?? 0) + 1;
  const daySpeechState = (settledState: GameState): GameState => {
    const eligibleSpeakerSeats = settledState.players
      .filter((player) => player.alive)
      .map((player) => player.seat);
    const speakingOrder = createSpeakingOrder({
      seed: state.seed ?? String(state.gameId),
      aliveSeats: eligibleSpeakerSeats,
      priorDeathSeats: resolution.eliminatedSeats,
      direction: "clockwise",
    });
    return {
      ...settledState,
      phase: "day_speech",
      dayNumber,
      lastNightEliminatedSeats: resolution.eliminatedSeats,
      speech: {
        kind: "ordinary",
        eligibleSpeakerSeats,
        speakingOrder,
        submittedSpeakerSeats: [],
        limit: state.speechLimits?.ordinary.maxCharacters ?? 220,
      },
      vote: null,
      publicVoteResult: null,
      pendingExileSeat: null,
    };
  };
  const firstNightLastWords = resolution.eliminations.filter((elimination) =>
    lastWordsEligibility({
      dayNumber: elimination.dayNumber,
      deathPhase: elimination.deathPhase,
      ruleset: {
        selfDestruct: { enabled: state.selfDestructEnabled !== false },
      },
    }));
  const continueAfterNight = (settledState: GameState): GameState => {
    if (firstNightLastWords.length === 0) return daySpeechState(settledState);
    const eligibleSpeakerSeats = firstNightLastWords.map((elimination) => elimination.seat);
    return {
      ...settledState,
      phase: "dawn_last_words",
      dayNumber,
      lastNightEliminatedSeats: resolution.eliminatedSeats,
      speech: {
        kind: "last_words",
        eligibleSpeakerSeats,
        speakingOrder: eligibleSpeakerSeats,
        submittedSpeakerSeats: [],
        limit: state.speechLimits?.lastWords.firstNightMaxCharacters ?? 150,
      },
      vote: null,
      publicVoteResult: null,
      pendingExileSeat: null,
    };
  };
  const nextPhase = firstNightLastWords.length > 0 ? "dawn_last_words" : "day_speech";
  const completed = completeDeathSettlement(
    {
      ...resolution.state,
      dayNumber,
      lastNightEliminatedSeats: resolution.eliminatedSeats,
    },
    resolution.eliminations,
    [
      ...inspectionBodies,
      {
        type: "night_resolved",
        eliminatedSeats: resolution.eliminatedSeats,
        audience: { kind: "public" },
      },
    ],
    continueAfterNight,
  );
  if (completed.state.phase === "settlement") return completed;
  return {
    state: completed.state,
    bodies: [
      ...completed.bodies,
      {
        type: "phase_advanced",
        phase: "dawn",
        audience: { kind: "public" },
      },
      {
        type: "phase_advanced",
        phase: nextPhase,
        audience: { kind: "public" },
      },
    ],
  };
};

const applyWolfCommand = (
  state: GameState,
  command: Extract<GameCommand, { type: "submit_wolf_kill" | "pass_action" }>,
): { readonly state: GameState; readonly bodies: readonly EventBody[] } => {
  const targetSeat = command.type === "submit_wolf_kill" ? command.targetSeat : null;
  const submissions = [...state.night.wolfSubmissions, { actorSeat: command.actorSeat, targetSeat }];
  const recordedState = submittedState(state, command);
  let nextState: GameState = {
    ...recordedState,
    night: {
      ...recordedState.night,
      wolfSubmissions: submissions,
    },
  };
  const bodies: EventBody[] = [actionRecordedBody(command)];
  const requiredWolves = aliveRolePlayers(state, "werewolf");
  if (submissions.length < requiredWolves.length) return { state: nextState, bodies };

  const agreed = submissions.every((submission) => submission.targetSeat === submissions[0]?.targetSeat);
  if (!agreed && state.night.wolfConfirmationRound === 1) {
    return {
      state: {
        ...nextState,
        phase: "night_wolf_final_confirmation",
        night: {
          ...nextState.night,
          wolfConfirmationRound: 2,
          wolfSubmissions: [],
          submittedActorSeats: [],
        },
      },
      bodies,
    };
  }

  const wolfTargetSeat = agreed ? wolfTargetFrom(submissions) : null;
  nextState = {
    ...nextState,
    night: { ...nextState.night, wolfTargetSeat },
  };
  if (wolfTargetSeat !== null) {
    nextState = addEffect(nextState, { type: "wolf_kill", targetSeat: wolfTargetSeat });
  }
  for (const wolf of requiredWolves) {
    bodies.push({
      type: "wolf_decision",
      targetSeat: wolfTargetSeat,
      recipientSeat: wolf.seat,
      audience: { kind: "private", seat: wolf.seat },
    });
  }
  nextState = advanceAfterWolves(nextState);
  if (aliveRolePlayers(nextState, "seer").length === 0 && aliveRolePlayers(nextState, "witch").length === 0) {
    const resolved = resolvePendingNight(nextState);
    return { state: resolved.state, bodies: [...bodies, ...resolved.bodies] };
  }
  return { state: nextState, bodies };
};

const applySeerCommand = (
  state: GameState,
  command: Extract<GameCommand, { type: "inspect_player" | "pass_action" }>,
): { readonly state: GameState; readonly bodies: readonly EventBody[] } => {
  let nextState = submittedState(state, command);
  const bodies: EventBody[] = [actionRecordedBody(command)];
  if (command.type === "inspect_player") {
    nextState = addEffect(nextState, {
      type: "inspection",
      actorSeat: command.actorSeat,
      targetSeat: command.targetSeat,
    });
  }
  if (aliveRolePlayers(nextState, "witch").length === 0) {
    const resolved = resolvePendingNight(nextState);
    return { state: resolved.state, bodies: [...bodies, ...resolved.bodies] };
  }
  return {
    state: {
      ...nextState,
      phase: "night_witch_action",
      night: { ...nextState.night, submittedActorSeats: [] },
    },
    bodies,
  };
};

const applyWitchCommand = (
  state: GameState,
  command: Extract<GameCommand, { type: "use_antidote" | "use_poison" | "pass_action" }>,
): { readonly state: GameState; readonly bodies: readonly EventBody[] } => {
  let nextState = submittedState(state, command);
  if (command.type === "use_antidote") {
    nextState = addEffect(nextState, { type: "antidote", actorSeat: command.actorSeat });
  } else if (command.type === "use_poison") {
    nextState = addEffect(nextState, {
      type: "poison",
      actorSeat: command.actorSeat,
      targetSeat: command.targetSeat,
    });
  }
  nextState = {
    ...nextState,
    night: { ...nextState.night, potionUsed: command.type !== "pass_action" },
  };
  const resolution = resolvePendingNight(nextState);
  return {
    state: resolution.state,
    bodies: [
      actionRecordedBody(command),
      ...resolution.bodies,
    ],
  };
};

const resetNight = (state: GameState): GameState["night"] => ({
  ...state.night,
  wolfConfirmationRound: 1,
  wolfSubmissions: [],
  submittedActorSeats: [],
  wolfTargetSeat: undefined,
  potionUsed: false,
});

const advanceToNight = (state: GameState): GameState => ({
  ...state,
  phase: "night_wolf_discussion",
  pendingEffects: [],
  pendingExileSeat: null,
  speech: null,
  vote: null,
  night: resetNight(state),
});

const applySelfDestructCommand = (
  state: GameState,
  command: Extract<GameCommand, { type: "self_destruct" }>,
): { readonly state: GameState; readonly bodies: readonly EventBody[] } => {
  const recordedState = withCommandRecord(state, command.commandId);
  const resolution = resolveDeaths(recordedState, [{
    type: "self_destruct",
    targetSeat: command.actorSeat,
  }]);
  return completeDeathSettlement(
    resolution.state,
    resolution.eliminations,
    [],
    (settledState) => ({
      ...settledState,
      phase: "day_self_destruct_last_words",
      pendingEffects: [],
      pendingExileSeat: null,
      speech: {
        kind: "last_words",
        eligibleSpeakerSeats: [command.actorSeat],
        speakingOrder: [command.actorSeat],
        submittedSpeakerSeats: [],
        limit: state.speechLimits?.lastWords.selfDestructMaxCharacters ?? 30,
      },
      vote: null,
    }),
  );
};

const publicVoteResultFrom = (
  vote: VoteRoundState,
  resolution: Exclude<ReturnType<typeof resolveVoteRound>, { kind: "pending" }>,
): PublicVoteResult => ({
  roundKind: vote.kind,
  roundVersion: vote.roundVersion,
  ballots: resolution.ballots,
  tally: resolution.tally,
  ...(resolution.kind === "exile" ? { exiledSeat: resolution.exiledSeat } : {}),
});

const completeVoteRound = (
  state: GameState,
  resolution: Exclude<ReturnType<typeof resolveVoteRound>, { kind: "pending" }>,
  initialBodies: readonly EventBody[],
): { readonly state: GameState; readonly bodies: readonly EventBody[] } => {
  const completedVote = state.vote!;
  const publicVoteResult = publicVoteResultFrom(completedVote, resolution);
  const bodies: EventBody[] = [
    ...initialBodies,
    {
      type: "vote_revealed",
      roundKind: completedVote.kind,
      roundVersion: completedVote.roundVersion,
      ballots: resolution.ballots,
      tally: resolution.tally,
      audience: { kind: "public" },
    },
  ];

  if (resolution.kind === "open_pk") {
    const eligibleVoterSeats = completedVote.eligibleVoterSeats
      .filter((seat) => !resolution.tiedCandidateSeats.includes(seat));
    const pkRoundVersion = state.version + bodies.length + 1;
    bodies.push({
      type: "pk_round_opened",
      candidateSeats: resolution.tiedCandidateSeats,
      eligibleVoterSeats,
      audience: { kind: "public" },
    });
    return {
      state: {
        ...state,
        phase: "day_pk_speech",
        publicVoteResult,
        speech: {
          kind: "pk",
          eligibleSpeakerSeats: resolution.tiedCandidateSeats,
          speakingOrder: resolution.tiedCandidateSeats,
          submittedSpeakerSeats: [],
          limit: 150,
        },
        vote: {
          kind: "pk",
          roundVersion: pkRoundVersion,
          eligibleVoterSeats,
          candidateSeats: resolution.tiedCandidateSeats,
          pendingBallots: [],
        },
      },
      bodies,
    };
  }

  if (resolution.kind === "no_exile") {
    bodies.push({
      type: "vote_tied_no_exile",
      tiedCandidateSeats: resolution.tiedCandidateSeats,
      audience: { kind: "public" },
    });
    return {
      state: {
        ...state,
        phase: "night_wolf_discussion",
        publicVoteResult,
        speech: null,
        vote: null,
        night: resetNight(state),
      },
      bodies,
    };
  }

  bodies.push({
    type: "exile_opened",
    exiledSeat: resolution.exiledSeat,
    audience: { kind: "public" },
  });
  return {
    state: {
      ...state,
      phase: "day_exile_last_words",
      publicVoteResult,
      pendingExileSeat: resolution.exiledSeat,
      vote: null,
      speech: {
        kind: "last_words",
        eligibleSpeakerSeats: [resolution.exiledSeat],
        speakingOrder: [resolution.exiledSeat],
        submittedSpeakerSeats: [],
        limit: 150,
      },
    },
    bodies,
  };
};

const applySpeechCommand = (
  state: GameState,
  command: Extract<GameCommand, { type: "submit_speech" }>,
): { readonly state: GameState; readonly bodies: readonly EventBody[] } => {
  const speech = state.speech!;
  const submittedSpeakerSeats = [...speech.submittedSpeakerSeats, command.actorSeat];
  let nextState: GameState = {
    ...withCommandRecord(state, command.commandId),
    speech: { ...speech, submittedSpeakerSeats },
  };

  const bodies: EventBody[] = [{
    type: "speech_published",
    seat: command.actorSeat,
    content: command.content,
    audience: { kind: "public" },
  }];

  if (submittedSpeakerSeats.length === speech.eligibleSpeakerSeats.length) {
    if (state.phase === "day_pk_speech") {
      nextState = { ...nextState, phase: "day_pk_vote", speech: null };
      const resolution = resolveVoteRound(nextState);
      if (resolution.kind !== "pending") {
        return completeVoteRound(nextState, resolution, bodies);
      }
    } else if (state.phase === "day_speech") {
      const eligibleVoterSeats = nextState.players
        .filter((player) => player.alive)
        .map((player) => player.seat);
      nextState = {
        ...nextState,
        phase: "day_vote",
        speech: null,
        vote: {
          kind: "exile",
          roundVersion: state.version + bodies.length,
          eligibleVoterSeats,
          candidateSeats: eligibleVoterSeats,
          pendingBallots: [],
        },
      };
    } else if (state.phase === "dawn_last_words") {
      const eligibleSpeakerSeats = nextState.players
        .filter((player) => player.alive)
        .map((player) => player.seat);
      nextState = {
        ...nextState,
        phase: "day_speech",
        speech: {
          kind: "ordinary",
          eligibleSpeakerSeats,
          speakingOrder: createSpeakingOrder({
            seed: state.seed ?? String(state.gameId),
            aliveSeats: eligibleSpeakerSeats,
            priorDeathSeats: state.lastNightEliminatedSeats ?? [],
            direction: "clockwise",
          }),
          submittedSpeakerSeats: [],
          limit: state.speechLimits?.ordinary.maxCharacters ?? 220,
        },
        vote: null,
      };
      bodies.push({
        type: "phase_advanced",
        phase: "day_speech",
        audience: { kind: "public" },
      });
    } else if (state.phase === "day_self_destruct_last_words") {
      nextState = advanceToNight(nextState);
      bodies.push({
        type: "phase_advanced",
        phase: "night_wolf_discussion",
        audience: { kind: "public" },
      });
    } else {
      const pendingExileSeat = state.pendingExileSeat!;
      const resolution = resolveDeaths(nextState, [{
        type: "exile",
        targetSeat: pendingExileSeat,
      }]);
      const completed = completeDeathSettlement(
        resolution.state,
        resolution.eliminations,
        bodies,
        advanceToNight,
      );
      if (completed.state.phase === "settlement") return completed;
      return {
        state: completed.state,
        bodies: [
          ...completed.bodies,
          {
            type: "phase_advanced",
            phase: "night_wolf_discussion",
            audience: { kind: "public" },
          },
        ],
      };
    }
  }

  return {
    state: nextState,
    bodies,
  };
};

const applyVoteCommand = (
  state: GameState,
  command: Extract<GameCommand, { type: "submit_vote" | "pass_action" }>,
): { readonly state: GameState; readonly bodies: readonly EventBody[] } => {
  const vote = state.vote!;
  const targetSeat = command.type === "submit_vote" ? command.targetSeat : null;
  const recordedState: GameState = {
    ...withCommandRecord(state, command.commandId),
    vote: {
      ...vote,
      pendingBallots: [...vote.pendingBallots, { actorSeat: command.actorSeat, targetSeat }],
    },
  };
  const bodies: EventBody[] = [{
    type: "vote_accepted",
    actorSeat: command.actorSeat,
    targetSeat,
    audience: { kind: "private", seat: command.actorSeat },
  }];
  const resolution = resolveVoteRound(recordedState);
  if (resolution.kind === "pending") return { state: recordedState, bodies };
  return completeVoteRound(recordedState, resolution, bodies);
};

export const applyCommand = (state: GameState, command: GameCommand): ApplyCommandResult => {
  if (state.processedCommandIds.includes(command.commandId)) {
    return { state, events: [] };
  }

  const reason = rejectionReason(state, command);
  if (reason !== undefined) return rejected(state, command, reason);

  let applied: { readonly state: GameState; readonly bodies: readonly EventBody[] };
  if (command.type === "self_destruct") {
    applied = applySelfDestructCommand(state, command);
  } else if (isVotePhase(state)) {
    applied = applyVoteCommand(state, command as Extract<GameCommand, { type: "submit_vote" | "pass_action" }>);
  } else if (isSpeechPhase(state)) {
    applied = applySpeechCommand(state, command as Extract<GameCommand, { type: "submit_speech" }>);
  } else if (state.phase === "night_wolf_discussion" || state.phase === "night_wolf_final_confirmation") {
    applied = applyWolfCommand(state, command as Extract<GameCommand, { type: "submit_wolf_kill" | "pass_action" }>);
  } else if (state.phase === "night_seer_action") {
    applied = applySeerCommand(state, command as Extract<GameCommand, { type: "inspect_player" | "pass_action" }>);
  } else {
    applied = applyWitchCommand(state, command as Extract<GameCommand, { type: "use_antidote" | "use_poison" | "pass_action" }>);
  }

  const events = applied.bodies.map((body, index) => makeEvent(state, index + 1, body));
  const result: ApplyCommandResult = {
    state: {
      ...applied.state,
      version: events.at(-1)?.version ?? state.version,
    },
    events,
  };
  assertGameState(result.state, state.version);
  return result;
};
