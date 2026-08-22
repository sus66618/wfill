import type {
  CommandId,
  EventId,
  GameCommand,
  GameEvent,
  SeatId,
} from "@wfill/contracts";
import { legalActionForCommand } from "./legal-actions.js";
import { resolveNight } from "./night-resolution.js";
import type { GameState, PendingEffect, PlayerState, WolfSubmission } from "../state/game-state.js";

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

const rejectionReason = (state: GameState, command: GameCommand): string | undefined => {
  if (state.gameId !== command.gameId) return "game_id_mismatch";
  if (state.version !== command.expectedVersion) return "version_conflict";

  const actor = state.players.find((player) => player.seat === command.actorSeat);
  if (actor === undefined) return "actor_not_found";
  if (!actor.alive) return "actor_not_alive";

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
  return {
    state: resolution.state,
    bodies: [
      ...inspectionBodies,
      {
        type: "night_resolved",
        eliminatedSeats: resolution.eliminatedSeats,
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

export const applyCommand = (state: GameState, command: GameCommand): ApplyCommandResult => {
  if (state.processedCommandIds.includes(command.commandId)) {
    return { state, events: [] };
  }

  const reason = rejectionReason(state, command);
  if (reason !== undefined) return rejected(state, command, reason);

  let applied: { readonly state: GameState; readonly bodies: readonly EventBody[] };
  if (state.phase === "night_wolf_discussion" || state.phase === "night_wolf_final_confirmation") {
    applied = applyWolfCommand(state, command as Extract<GameCommand, { type: "submit_wolf_kill" | "pass_action" }>);
  } else if (state.phase === "night_seer_action") {
    applied = applySeerCommand(state, command as Extract<GameCommand, { type: "inspect_player" | "pass_action" }>);
  } else {
    applied = applyWitchCommand(state, command as Extract<GameCommand, { type: "use_antidote" | "use_poison" | "pass_action" }>);
  }

  const events = applied.bodies.map((body, index) => makeEvent(state, index + 1, body));
  return {
    state: {
      ...applied.state,
      version: events.at(-1)?.version ?? state.version,
    },
    events,
  };
};
