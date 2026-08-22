import {
  gameViewSchema,
  type GameEvent,
  type GameView,
  type SeatView,
  type SpectatorMode,
  type TimelineItem,
} from "@wfill/contracts";
import { getLegalActions, type GameState } from "@wfill/game-engine";

export interface ProjectGameViewInput {
  readonly state: GameState;
  readonly playerEvents: readonly GameEvent[];
  readonly auditEvents: readonly GameEvent[];
  readonly mode: SpectatorMode;
}

const eventVisibleTo = (event: GameEvent, mode: SpectatorMode): boolean => {
  if (mode.kind === "god") return true;
  if (event.audience.kind === "public") return true;
  return mode.kind === "seat"
    && event.audience.kind === "private"
    && event.audience.seat === mode.seat;
};

const systemTextFor = (event: GameEvent): string | null => {
  switch (event.type) {
    case "game_created": return "对局已创建。";
    case "phase_advanced": return `阶段已推进至 ${event.phase}。`;
    case "night_resolved": return event.eliminatedSeats.length === 0
      ? "昨夜平安夜。"
      : `昨夜死亡座位：${event.eliminatedSeats.join("、")}。`;
    case "pk_round_opened": return `平票 PK：${event.candidateSeats.join("、")} 号。`;
    case "vote_tied_no_exile": return "再次平票，本轮无人出局。";
    case "exile_opened": return `${event.exiledSeat} 号被放逐。`;
    case "game_finished": return event.winner === "good" ? "好人阵营获胜。" : "狼人阵营获胜。";
    default: return null;
  }
};

const mapTimelineItem = (event: GameEvent): TimelineItem | null => {
  const envelope = {
    id: event.eventId,
    version: event.version,
    day: event.dayNumber ?? 0,
  };
  const systemText = systemTextFor(event);
  if (systemText) return { ...envelope, kind: "system", text: systemText };

  switch (event.type) {
    case "speech_published":
      return { ...envelope, kind: "speech", seat: event.seat, content: event.content };
    case "vote_revealed":
      return { ...envelope, kind: "vote", ballots: event.ballots };
    case "player_eliminated":
      return { ...envelope, kind: "elimination", seat: event.seat };
    case "elimination_cause_recorded":
      return { ...envelope, kind: "death_detail", seat: event.seat, cause: event.cause };
    case "inspection_result":
      return {
        ...envelope,
        kind: "inspection",
        actorSeat: event.actorSeat,
        targetSeat: event.targetSeat,
        faction: event.faction,
      };
    case "night_action_recorded":
      return {
        ...envelope,
        kind: "night_action",
        actorSeat: event.actorSeat,
        action: event.action,
        ...(event.targetSeat === undefined ? {} : { targetSeat: event.targetSeat }),
      };
    case "wolf_decision":
      return { ...envelope, kind: "wolf_decision", targetSeat: event.targetSeat };
    default:
      // 身份分配、私密投票确认、拒绝详情和审计检查点不属于观战时间线。
      return null;
  }
};

const projectSeats = (state: GameState, mode: SpectatorMode): SeatView[] => state.players.map((player) => {
  const isSelf = mode.kind === "seat" && mode.seat === player.seat;
  const viewer = mode.kind === "seat"
    ? state.players.find((candidate) => candidate.seat === mode.seat)
    : undefined;
  const isKnownWolfTeammate = viewer?.roleId === "werewolf"
    && viewer.privateState.wolfTeammateSeats.includes(player.seat);
  const visibleRole = mode.kind === "god"
    ? { roleId: player.roleId, source: "god" as const }
    : isSelf
      ? { roleId: player.roleId, source: "self" as const }
      : isKnownWolfTeammate
        ? { roleId: player.roleId, source: "wolf_team" as const }
        : undefined;
  const maySeeWitchResources = player.roleId === "witch" && (mode.kind === "god" || isSelf);

  return {
    seat: player.seat,
    alive: player.alive,
    isCurrentActor: getLegalActions(state, player.seat).length > 0,
    ...(visibleRole ? { visibleRole } : {}),
    ...(maySeeWitchResources && player.privateState.witchResources
      ? { witchResources: { ...player.privateState.witchResources } }
      : {}),
  };
});

export const projectGameView = ({ state, playerEvents, auditEvents, mode }: ProjectGameViewInput): GameView => {
  const visibleEvents = [...playerEvents, ...(mode.kind === "god" ? auditEvents : [])]
    .filter((event) => eventVisibleTo(event, mode))
    .filter((event) => event.type !== "command_committed")
    .sort((left, right) => left.version - right.version || left.eventId.localeCompare(right.eventId));
  const timeline = visibleEvents
    .map(mapTimelineItem)
    .filter((item): item is TimelineItem => item !== null);
  const view = {
    gameId: state.gameId,
    version: state.version,
    day: state.dayNumber ?? 0,
    phase: state.phase,
    outcome: state.outcome === "good_win" || state.outcome === "wolf_win" ? state.outcome : null,
    mode,
    seats: projectSeats(state, mode),
    timeline,
  };

  // 浏览器边界始终由严格协议做最后一次白名单校验。
  return gameViewSchema.parse(view);
};

