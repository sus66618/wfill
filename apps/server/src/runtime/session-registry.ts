import {
  GameSessionRunner,
  InMemoryGameUpdatePublisher,
  projectGameView,
  type RunnerStatus,
} from "@wfill/application";
import type { GameId, GameView, SessionControl } from "@wfill/contracts";
import { createGame } from "@wfill/game-engine";
import {
  SqliteSessionRecoveryService,
  SqliteSessionRepository,
} from "@wfill/persistence";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import type { DatabaseSync } from "node:sqlite";
import { createDemoControllers, type DemoSeed } from "./demo-scripts.js";

export class SessionRegistry {
  readonly publisher = new InMemoryGameUpdatePublisher();
  readonly repository: SqliteSessionRepository;
  private readonly recovery: SqliteSessionRecoveryService;
  private readonly runners = new Map<GameId, GameSessionRunner>();

  constructor(database: DatabaseSync) {
    this.repository = new SqliteSessionRepository(database);
    this.recovery = new SqliteSessionRecoveryService(database);
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
    this.runners.set(gameId, this.createRunner(gameId, seed));
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

  private runner(gameId: GameId): GameSessionRunner {
    const existing = this.runners.get(gameId);
    if (existing) return existing;
    const recovered = this.recovery.recover(gameId);
    const seed = recovered.state.seed as DemoSeed;
    if (seed !== "good-win" && seed !== "wolf-win") throw new Error("unsupported_demo_seed");
    const runner = this.createRunner(gameId, seed);
    this.runners.set(gameId, runner);
    return runner;
  }

  private createRunner(gameId: GameId, seed: DemoSeed): GameSessionRunner {
    return new GameSessionRunner({
      gameId,
      repository: this.repository,
      controllers: createDemoControllers(seed),
      publisher: this.publisher,
    });
  }
}
