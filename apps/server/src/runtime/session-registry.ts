import {
  GameSessionRunner,
  InMemoryGameUpdatePublisher,
  projectGameView,
  type RunnerStatus,
} from "@wfill/application";
import type { GameId, GameView, SessionControl } from "@wfill/contracts";
import type { GameUpdateListener } from "@wfill/application";
import type { SessionUpdate, SpectatorMode } from "@wfill/contracts";
import { createGame } from "@wfill/game-engine";
import {
  SqliteSessionRecoveryService,
  SqliteSessionRepository,
  SqliteUpdateLogRepository,
} from "@wfill/persistence";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import type { DatabaseSync } from "node:sqlite";
import { createDemoControllers, type DemoSeed } from "./demo-scripts.js";

export class SessionRegistry {
  readonly publisher = new InMemoryGameUpdatePublisher();
  readonly repository: SqliteSessionRepository;
  private readonly recovery: SqliteSessionRecoveryService;
  private readonly updateLog: SqliteUpdateLogRepository;
  private readonly runners = new Map<GameId, GameSessionRunner>();
  private activeSubscribers = 0;

  constructor(database: DatabaseSync) {
    this.repository = new SqliteSessionRepository(database);
    this.recovery = new SqliteSessionRecoveryService(database);
    this.updateLog = new SqliteUpdateLogRepository(database);
  }

  create(gameId: GameId, seed: DemoSeed): GameView {
    if (this.repository.load(gameId)) throw new Error("session_already_exists");
    const created = createGame({ gameId, ruleset: SIX_PLAYER_RULESET, seed });
    this.repository.create({
      state: created.state,
      initialState: created.state,
      playerEvents: created.events,
      auditEvents: [],
    });
    const modes: SpectatorMode[] = [
      { kind: "public" },
      ...created.state.players.map((player) => ({ kind: "seat" as const, seat: player.seat })),
      { kind: "god" },
    ];
    const updates: SessionUpdate[] = modes.map((mode) => ({
      type: "view_snapshot",
      sequence: 1,
      gameId,
      audience: mode,
      view: projectGameView({
        state: created.state,
        playerEvents: created.events,
        auditEvents: [],
        mode,
      }),
    }));
    // 初始安全快照也进入持久化序列，SSE 首连和断线恢复使用同一条路径。
    this.repository.appendTransition({
      gameId,
      expectedPreviousVersion: created.state.version,
      state: created.state,
      playerEvents: [],
      auditEvents: [],
      updates,
    });
    this.runners.set(gameId, this.createRunner(gameId, seed, 0));
    return this.view(gameId);
  }

  list(): GameView[] {
    return this.repository.list().map((session) => projectGameView({
      ...session,
      mode: { kind: "public" },
    }));
  }

  view(gameId: GameId): GameView {
    const session = this.repository.load(gameId);
    if (!session) throw new Error("session_not_found");
    return projectGameView({ ...session, mode: { kind: "public" } });
  }

  async control(gameId: GameId, control: SessionControl): Promise<{ view: GameView; runner: RunnerStatus }> {
    const runner = this.runner(gameId);
    if (control.type === "start" || control.type === "resume") await runner.resume();
    else if (control.type === "pause") await runner.pause();
    else await runner.step();
    return { view: this.view(gameId), runner: runner.status() };
  }

  async close(): Promise<void> {
    await Promise.all([...this.runners.values()].map((runner) => runner.stop()));
    this.runners.clear();
  }

  readUpdatesAfter(gameId: GameId, sequence: number, mode: SpectatorMode): readonly SessionUpdate[] {
    if (!this.repository.load(gameId)) throw new Error("session_not_found");
    return this.updateLog.readAfter(gameId, sequence, mode);
  }

  lastUpdateSequence(gameId: GameId): number {
    if (!this.repository.load(gameId)) throw new Error("session_not_found");
    return this.repository.lastUpdateSequence(gameId);
  }

  subscribe(gameId: GameId, mode: SpectatorMode, listener: GameUpdateListener): () => void {
    if (!this.repository.load(gameId)) throw new Error("session_not_found");
    this.activeSubscribers += 1;
    const dispose = this.publisher.subscribe(gameId, mode, listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeSubscribers -= 1;
      dispose();
    };
  }

  subscriberCount(): number {
    return this.activeSubscribers;
  }

  private runner(gameId: GameId): GameSessionRunner {
    const existing = this.runners.get(gameId);
    if (existing) return existing;
    const recovered = this.recovery.recover(gameId);
    const seed = recovered.state.seed as DemoSeed;
    if (seed !== "good-win" && seed !== "wolf-win") throw new Error("unsupported_demo_seed");
    const runner = this.createRunner(gameId, seed, recovered.state.processedCommandIds.length);
    this.runners.set(gameId, runner);
    return runner;
  }

  private createRunner(gameId: GameId, seed: DemoSeed, consumedCommands: number): GameSessionRunner {
    return new GameSessionRunner({
      gameId,
      repository: this.repository,
      controllers: createDemoControllers(seed, consumedCommands),
      publisher: this.publisher,
    });
  }
}
