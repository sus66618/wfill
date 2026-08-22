import { describe, expect, it } from "vitest";
import type {
  GameEvent,
  GameId,
  SeatId,
  SessionUpdate,
  SpectatorMode,
} from "@wfill/contracts";
import { createGame, type ScriptedCommand } from "@wfill/game-engine";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import { GOOD_WIN_SCRIPT } from "../../game-engine/test/fixtures/good-win-script.js";
import { WOLF_WIN_SCRIPT } from "../../game-engine/test/fixtures/wolf-win-script.js";
import {
  GameSessionRunner,
  InMemoryGameUpdatePublisher,
  ModelTurnRequiredError,
  ScriptedPlayerController,
  StaticControllerRegistry,
  type SessionRepository,
  type SessionTransition,
  type StoredSession,
} from "../src/index.js";

class MemorySessionRepository implements SessionRepository {
  private session: StoredSession;
  private updates: SessionUpdate[] = [];

  constructor(session: StoredSession) {
    this.session = session;
  }

  create(session: StoredSession): void { this.session = session; }
  load(gameId: GameId): StoredSession | null { return gameId === this.session.state.gameId ? this.session : null; }
  list(): readonly StoredSession[] { return [this.session]; }
  lastUpdateSequence(): number { return Math.max(0, ...this.updates.map((update) => update.sequence)); }
  close(): void {}

  appendTransition(transition: SessionTransition): void {
    if (transition.expectedPreviousVersion !== this.session.state.version) throw new Error("memory_version_conflict");
    this.session = {
      ...this.session,
      state: transition.state,
      playerEvents: [...this.session.playerEvents, ...transition.playerEvents],
      auditEvents: [...this.session.auditEvents, ...transition.auditEvents],
    };
    this.updates.push(...transition.updates);
  }
}

const decisionFor = (command: ScriptedCommand) => {
  const { actorSeat: _actorSeat, ...decision } = command;
  return decision;
};

const createRunner = (seed: string, commands: readonly ScriptedCommand[]) => {
  const created = createGame({ gameId: `runner-${seed}`, ruleset: SIX_PLAYER_RULESET, seed });
  const repository = new MemorySessionRepository({
    initialState: created.state,
    state: created.state,
    playerEvents: created.events,
    auditEvents: [],
  });
  const controllers = new Map<SeatId, ScriptedPlayerController>();
  for (let value = 1; value <= 6; value += 1) {
    const actorSeat = value as SeatId;
    controllers.set(actorSeat, new ScriptedPlayerController(
      commands.filter((command) => command.actorSeat === actorSeat).map(decisionFor),
    ));
  }
  const publisher = new InMemoryGameUpdatePublisher();
  const runner = new GameSessionRunner({
    gameId: created.state.gameId,
    repository,
    controllers: new StaticControllerRegistry(controllers),
    publisher,
  });
  return { created, repository, publisher, runner };
};

describe("单写者对局编排器", () => {
  it("强制模型动作最终失败时暂停且不改变对局", async () => {
    const created = createGame({ gameId: "mandatory-pause", ruleset: SIX_PLAYER_RULESET, seed: "good-win" });
    const repository = new MemorySessionRepository({
      initialState: created.state, state: created.state, playerEvents: created.events, auditEvents: [],
    });
    const failingController = { request: async () => { throw new ModelTurnRequiredError(); } };
    const controllers = new Map<SeatId, typeof failingController>();
    for (let value = 1; value <= 6; value += 1) controllers.set(value as SeatId, failingController);
    const runner = new GameSessionRunner({
      gameId: created.state.gameId,
      repository,
      controllers: new StaticControllerRegistry(controllers),
      publisher: new InMemoryGameUpdatePublisher(),
    });
    await expect(runner.step()).resolves.toBeUndefined();
    expect(runner.status()).toEqual({ mode: "paused", inFlight: false });
    expect(repository.load(created.state.gameId)?.state.version).toBe(created.state.version);
  });

  it("单步模式只处理一条命令并重新暂停", async () => {
    const fixture = createRunner(GOOD_WIN_SCRIPT.seed, GOOD_WIN_SCRIPT.commands);
    await fixture.runner.step();
    expect(fixture.repository.load(fixture.created.state.gameId)?.state.version)
      .toBe(fixture.created.state.version + 1);
    expect(fixture.runner.status()).toEqual({ mode: "paused", inFlight: false });
  });

  it.each([
    ["good", GOOD_WIN_SCRIPT, "good_win"],
    ["wolf", WOLF_WIN_SCRIPT, "wolf_win"],
  ] as const)("通过应用编排完成 %s 胜局", async (_name, script, outcome) => {
    const fixture = createRunner(script.seed, script.commands);
    await Promise.all([fixture.runner.resume(), fixture.runner.resume(), fixture.runner.resume()]);
    const stored = fixture.repository.load(fixture.created.state.gameId)!;
    expect(stored.state.outcome).toBe(outcome);
    expect(stored.state.phase).toBe("settlement");
    expect(stored.state.processedCommandIds).toHaveLength(script.commands.length);
    expect(fixture.runner.status()).toEqual({ mode: "finished", inFlight: false });
  });

  it("不同观战视角获得独立安全快照", async () => {
    const fixture = createRunner(GOOD_WIN_SCRIPT.seed, GOOD_WIN_SCRIPT.commands);
    const received = new Map<string, SessionUpdate[]>();
    const subscribe = (mode: SpectatorMode, key: string) => fixture.publisher.subscribe(
      fixture.created.state.gameId,
      mode,
      (update) => received.set(key, [...(received.get(key) ?? []), update]),
    );
    const disposePublic = subscribe({ kind: "public" }, "public");
    const disposeGod = subscribe({ kind: "god" }, "god");
    await fixture.runner.step();
    disposePublic();
    disposeGod();
    expect(received.get("public")).toHaveLength(1);
    expect(received.get("god")).toHaveLength(1);
    expect(JSON.stringify(received.get("public"))).not.toMatch(/roleId|command_committed|auditEvents/);
    expect(JSON.stringify(received.get("god"))).not.toMatch(/command_committed|processedCommandIds/);
  });
});
