import type {
  CommandId,
  GameCommand,
  GameId,
  SeatId,
  SessionUpdate,
  SpectatorMode,
} from "@wfill/contracts";
import { applyCommand, getLegalActions, type GameState } from "@wfill/game-engine";
import type {
  ControllerRegistry,
  GameUpdatePublisher,
  PlayerDecision,
  SessionRepository,
} from "./ports.js";
import { projectGameView } from "./project-game-view.js";
import { ModelTurnRequiredError } from "./model/failure-policy.js";

export type RunnerMode = "idle" | "running" | "paused" | "finished" | "failed";

export interface RunnerStatus {
  readonly mode: RunnerMode;
  readonly inFlight: boolean;
}

export interface GameSessionRunnerInput {
  readonly gameId: GameId;
  readonly repository: SessionRepository;
  readonly controllers: ControllerRegistry;
  readonly publisher: GameUpdatePublisher;
}

const modeKey = (mode: SpectatorMode): string => mode.kind === "seat" ? `seat:${mode.seat}` : mode.kind;

const expectedVersionFor = (state: GameState, decision: PlayerDecision): number => {
  if (
    (decision.type === "submit_vote" || decision.type === "pass_action")
    && (state.phase === "day_vote" || state.phase === "day_pk_vote")
    && state.vote
  ) return state.vote.roundVersion;
  return state.version;
};

const commandFor = (
  gameId: GameId,
  state: GameState,
  actorSeat: SeatId,
  decision: PlayerDecision,
): GameCommand => ({
  ...decision,
  commandId: `${gameId}:command:${state.processedCommandIds.length + 1}` as CommandId,
  gameId,
  expectedVersion: expectedVersionFor(state, decision),
  actorSeat,
} as GameCommand);

const modesFor = (state: GameState): SpectatorMode[] => [
  { kind: "public" },
  ...state.players.map((player) => ({ kind: "seat" as const, seat: player.seat })),
  { kind: "god" },
];

export class GameSessionRunner {
  private desiredMode: "running" | "paused" | "step" = "paused";
  private currentStatus: RunnerStatus = { mode: "idle", inFlight: false };
  private pumpPromise: Promise<void> | null = null;
  private activeAbort: AbortController | null = null;

  constructor(private readonly input: GameSessionRunnerInput) {}

  status(): RunnerStatus {
    return { ...this.currentStatus };
  }

  start(): Promise<void> {
    return this.resume();
  }

  resume(): Promise<void> {
    if (this.currentStatus.mode === "finished") return Promise.resolve();
    this.desiredMode = "running";
    this.currentStatus = { mode: "running", inFlight: this.currentStatus.inFlight };
    return this.ensurePump();
  }

  step(): Promise<void> {
    if (this.currentStatus.mode === "finished") return Promise.resolve();
    this.desiredMode = "step";
    this.currentStatus = { mode: "running", inFlight: this.currentStatus.inFlight };
    return this.ensurePump();
  }

  async pause(): Promise<void> {
    this.desiredMode = "paused";
    if (this.pumpPromise) await this.pumpPromise;
    if (this.currentStatus.mode !== "finished" && this.currentStatus.mode !== "failed") {
      this.currentStatus = { mode: "paused", inFlight: false };
    }
  }

  async stop(): Promise<void> {
    this.desiredMode = "paused";
    this.activeAbort?.abort();
    if (this.pumpPromise) await this.pumpPromise;
    if (this.currentStatus.mode !== "finished") this.currentStatus = { mode: "paused", inFlight: false };
  }

  private ensurePump(): Promise<void> {
    if (this.pumpPromise) return this.pumpPromise;
    this.pumpPromise = this.pump().finally(() => {
      this.pumpPromise = null;
      this.activeAbort = null;
      this.currentStatus = { ...this.currentStatus, inFlight: false };
    });
    return this.pumpPromise;
  }

  private async pump(): Promise<void> {
    while (this.desiredMode !== "paused") {
      const stored = this.input.repository.load(this.input.gameId);
      if (!stored) {
        this.currentStatus = { mode: "failed", inFlight: false };
        throw new Error("session_not_found");
      }
      if (stored.state.phase === "settlement" || stored.state.outcome !== "ongoing") {
        this.currentStatus = { mode: "finished", inFlight: false };
        return;
      }

      const actor = [...stored.state.players]
        .sort((left, right) => left.seat - right.seat)
        .map((player) => ({ player, legalActions: getLegalActions(stored.state, player.seat) }))
        // 自爆是发言窗口中的可选中断，不能单独把非当前发言狼人调度成必行动者。
        .find((candidate) => candidate.legalActions.some((action) => action.type !== "self_destruct"));
      if (!actor) {
        this.currentStatus = { mode: "failed", inFlight: false };
        throw new Error(`session_has_no_legal_actor:${stored.state.phase}`);
      }

      const view = projectGameView({
        state: stored.state,
        playerEvents: stored.playerEvents,
        auditEvents: stored.auditEvents,
        mode: { kind: "seat", seat: actor.player.seat },
      });
      const speechBudget = actor.legalActions.find((action) => action.type === "submit_speech")?.speechLimit ?? null;
      this.activeAbort = new AbortController();
      this.currentStatus = { mode: "running", inFlight: true };
      let decision: PlayerDecision;
      try {
        decision = await this.input.controllers.get(actor.player.seat).request({
          gameId: this.input.gameId,
          actorSeat: actor.player.seat,
          expectedVersion: stored.state.version,
          taskKind: stored.state.phase,
          view,
          legalActions: actor.legalActions,
          speechBudget,
        }, this.activeAbort.signal);
      } catch (error) {
        if (error instanceof ModelTurnRequiredError) {
          this.currentStatus = { mode: "paused", inFlight: false };
          this.desiredMode = "paused";
          return;
        }
        this.currentStatus = { mode: "failed", inFlight: false };
        this.desiredMode = "paused";
        throw error;
      }
      this.currentStatus = { mode: "running", inFlight: false };

      const result = applyCommand(stored.state, commandFor(this.input.gameId, stored.state, actor.player.seat, decision));
      const allPlayerEvents = [...stored.playerEvents, ...result.events];
      const allAuditEvents = [...stored.auditEvents, ...(result.auditEvents ?? [])];
      const sequence = this.input.repository.lastUpdateSequence(this.input.gameId) + 1;
      const updates: SessionUpdate[] = modesFor(result.state).map((mode) => ({
        type: "view_snapshot",
        sequence,
        gameId: this.input.gameId,
        audience: mode,
        view: projectGameView({
          state: result.state,
          playerEvents: allPlayerEvents,
          auditEvents: allAuditEvents,
          mode,
        }),
      }));
      if (new Set(updates.map((update) => modeKey(update.audience))).size !== updates.length) {
        throw new Error("duplicate_projection_audience");
      }

      this.input.repository.appendTransition({
        gameId: this.input.gameId,
        expectedPreviousVersion: stored.state.version,
        state: result.state,
        playerEvents: result.events,
        auditEvents: result.auditEvents ?? [],
        updates,
      });
      this.input.publisher.publish(this.input.gameId, updates);

      if (result.state.phase === "settlement" || result.state.outcome !== "ongoing") {
        this.currentStatus = { mode: "finished", inFlight: false };
        this.desiredMode = "paused";
        return;
      }
      if (this.desiredMode === "step") {
        this.desiredMode = "paused";
        this.currentStatus = { mode: "paused", inFlight: false };
        return;
      }
    }
    if (this.currentStatus.mode !== "failed") this.currentStatus = { mode: "paused", inFlight: false };
  }
}
