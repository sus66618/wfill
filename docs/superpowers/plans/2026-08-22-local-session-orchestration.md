# Local Session Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local application backend that projects safe spectator views, persists six-player games in SQLite, restores them after restart, and drives scripted controllers through automatic, paused, and single-step sessions over REST and SSE.

**Architecture:** Add application and persistence packages around the already-reviewed pure game engine, plus a thin Fastify server. The application layer owns view projection and one-writer session orchestration through ports; the SQLite and HTTP implementations remain replaceable so later model-gateway, React, Cloudflare, or Sites work does not change domain rules.

**Tech Stack:** TypeScript, Node.js 22, pnpm workspace, Zod, built-in `node:sqlite`, Fastify, SSE, Vitest

**Spec:** `docs/superpowers/specs/2026-08-22-local-ai-gameplay-design.md`

## Global Constraints

- Local-only first release: no Cloudflare, Codex Sites, public auth, Steam, or cloud credentials.
- The only runnable ruleset is `six-player-classic-no-sheriff@1.0.0`.
- First-night deaths of any cause and count receive ordered last words; later-night deaths do not; daytime exile receives last words.
- No public projection may contain roles, hidden death causes, wolf chat, private actions, god audit payloads, provider names, model names, credentials, prompts, or raw model responses.
- The game engine remains pure and cannot import Fastify, SQLite, model gateways, or UI code.
- One `GameSessionRunner` is the sole command writer for a running game.
- Every persisted processed command, accepted or rejected, must retain exact audit-journal recovery and idempotency semantics.
- All production code comments are written in Chinese.
- Every task uses TDD, passes focused tests, full tests, typecheck, build, `git diff --check`, and ends in one focused commit.

---

## File Structure

```text
packages/application/
  src/views.ts                         # Browser-safe projection contracts
  src/project-game-view.ts             # Audience projection and timeline mapping
  src/ports.ts                         # Session store, controller, update publisher ports
  src/session-runner.ts                # Single-writer automatic/step/pause loop
  src/scripted-player-controller.ts     # Deterministic integration controller
  src/index.ts                         # Public application API
  test/project-game-view.test.ts
  test/session-runner.test.ts

packages/persistence/
  src/sqlite/database.ts               # SQLite opening, pragmas and transactions
  src/sqlite/migrations.ts             # Versioned schema migrations
  src/sqlite/session-repository.ts      # Session metadata, snapshots and journal
  src/sqlite/update-log-repository.ts   # Safe update sequence used for SSE replay
  src/index.ts
  test/sqlite-session-repository.test.ts
  test/sqlite-recovery.test.ts

apps/server/
  src/app.ts                            # Fastify composition root
  src/routes/sessions.ts               # Create/read/control REST endpoints
  src/routes/session-events.ts          # SSE stream and Last-Event-ID recovery
  src/runtime/session-registry.ts       # One runner per active game
  src/index.ts                          # Local executable entry
  test/session-api.test.ts
  test/session-sse.test.ts

packages/contracts/src/application.ts   # REST/SSE schemas shared with future web UI
packages/contracts/src/index.ts
vitest.config.ts
pnpm-workspace.yaml
package.json
README.md
```

---

### Task 1: Application View Contracts and Workspace Packages

**Files:**
- Create: `packages/contracts/src/application.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/application/package.json`
- Create: `packages/application/tsconfig.json`
- Create: `packages/application/src/views.ts`
- Create: `packages/application/src/ports.ts`
- Create: `packages/application/src/index.ts`
- Create: `packages/persistence/package.json`
- Create: `packages/persistence/tsconfig.json`
- Create: `packages/persistence/src/index.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Test: `packages/contracts/test/application-contracts.test.ts`

**Interfaces:**
- Consumes: `GameId`, `SeatId`, `Audience`, and phase/outcome types from `@wfill/contracts` and `@wfill/game-engine`.
- Produces: `SpectatorMode`, `GameView`, `SeatView`, `TimelineItem`, `SessionControl`, `SessionUpdate`, their Zod schemas, and the `SessionRepository`/`GameUpdatePublisher` ports consumed by persistence and orchestration.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from "vitest";
import { gameViewSchema, sessionControlSchema } from "../src/application.js";

describe("application contracts", () => {
  it("rejects hidden fields from a browser game view", () => {
    const parsed = gameViewSchema.safeParse({
      gameId: "g-1",
      version: 8,
      day: 1,
      phase: "day_speech",
      outcome: null,
      mode: { kind: "public" },
      seats: [],
      timeline: [],
      cause: "poison"
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts only start, pause, resume and step controls", () => {
    expect(sessionControlSchema.parse({ type: "step" })).toEqual({ type: "step" });
    expect(sessionControlSchema.safeParse({ type: "force_win" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run packages/contracts/test/application-contracts.test.ts`

Expected: FAIL because `application.ts` and schemas do not exist.

- [ ] **Step 3: Define strict browser-safe schemas and package manifests**

```ts
export const spectatorModeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }).strict(),
  z.object({ kind: z.literal("seat"), seat: seatIdSchema }).strict(),
  z.object({ kind: z.literal("god") }).strict()
]);

export const sessionControlSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("pause") }).strict(),
  z.object({ type: z.literal("resume") }).strict(),
  z.object({ type: z.literal("step") }).strict()
]);
```

Define `GameView` with only `gameId`, `version`, `day`, `phase`, `outcome`, `mode`, safe `seats`, and safe `timeline`. `SessionUpdate` is a strict union of `view_snapshot`, `timeline_appended`, `runner_status`, and `connection_heartbeat`, each carrying a monotonic `sequence`.

Define `SessionRepository` with `create`, `appendTransition`, `load`, `list`, and `close`; define `GameUpdatePublisher.publish(gameId, updates)` and `subscribe(gameId, mode, listener)`. Recovery is a Task 4 service layered on this repository rather than an unimplemented Task 1 port. Use type-only imports so these ports do not depend on SQLite or Fastify.

- [ ] **Step 4: Add workspace build/typecheck/test discovery**

Add `@wfill/application` and `@wfill/persistence` to the existing workspace conventions, source-mode development exports, dist production exports, and the root build/typecheck chain.

- [ ] **Step 5: Run focused and global verification**

Run: `pnpm vitest run packages/contracts/test/application-contracts.test.ts && pnpm test && pnpm typecheck`

Expected: focused test PASS; existing 116 tests remain PASS; all packages build.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml vitest.config.ts packages/contracts packages/application packages/persistence
git commit -m "feat: define local application contracts"
```

---

### Task 2: Audience-Safe Game Projection

**Files:**
- Create: `packages/application/src/project-game-view.ts`
- Modify: `packages/application/src/index.ts`
- Test: `packages/application/test/project-game-view.test.ts`

**Interfaces:**
- Consumes: `projectGameView(state, playerEvents, auditEvents, mode)` inputs from the engine and `SpectatorMode` from Task 1.
- Produces: `projectGameView(input: ProjectGameViewInput): GameView`.

- [ ] **Step 1: Write failing permission-matrix tests**

```ts
it.each([
  ["public", false, false, false],
  ["seat-1", true, false, false],
  ["seat-3", false, true, false],
  ["god", true, true, true]
])("projects %s without privilege escalation", (name, seesOwnRole, seesWolfChat, seesCause) => {
  const view = projectFixture(name);
  expect(hasRole(view, 1)).toBe(seesOwnRole);
  expect(hasWolfChat(view)).toBe(seesWolfChat);
  expect(hasDeathCause(view)).toBe(seesCause);
  expect(JSON.stringify(view)).not.toContain("api-key");
});
```

Use a fixture where seat 1 is a villager, seat 3 is a wolf, the witch poisons one seat, wolves chat, and a public player speaks. Also assert that no mode contains provider/model names, prompts, raw responses, or god checkpoint state.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/application/test/project-game-view.test.ts`

Expected: FAIL because `projectGameView` does not exist.

- [ ] **Step 3: Implement explicit allow-list projection**

Implement separate functions `projectSeatCards`, `projectTimeline`, and `projectPrivateRolePanel`. Never spread engine state or event payloads into browser objects. Use `filterEventsForAudience` only as an initial audience check; map every allowed event type into a strict safe timeline variant.

- [ ] **Step 4: Add strict schema round-trip tests**

Parse every produced view through `gameViewSchema`, then recursively assert forbidden property names are absent: `cause`, `audit`, `checkpoint`, `credential`, `provider`, `model`, `prompt`, `rawResponse`, and `processedCommandIds`, except `cause` is permitted only inside the god-only safe death detail type whose schema is not part of public/seat modes.

- [ ] **Step 5: Run verification**

Run: `pnpm vitest run packages/application/test/project-game-view.test.ts && pnpm test && pnpm typecheck && git diff --check`

Expected: permission matrix PASS with existing engine privacy tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/application
git commit -m "feat: project safe spectator game views"
```

---

### Task 3: SQLite Schema and Session Repository

**Files:**
- Create: `packages/persistence/src/sqlite/database.ts`
- Create: `packages/persistence/src/sqlite/migrations.ts`
- Create: `packages/persistence/src/sqlite/session-repository.ts`
- Modify: `packages/persistence/src/index.ts`
- Test: `packages/persistence/test/sqlite-session-repository.test.ts`

**Interfaces:**
- Consumes: canonical `GameState`, `GameEvent`, `AuditEvent`, ruleset snapshot, seat controller snapshots, and `GameView` updates.
- Produces: `SqliteSessionRepository` implementing `SessionRepository` with `create`, `appendTransition`, `load`, `list`, and `close`.

- [ ] **Step 1: Write failing transactional repository tests**

```ts
it("atomically stores a command transition and restores exact ordering", () => {
  const repo = openTemporaryRepository();
  repo.create(fixtureSession);
  repo.appendTransition({
    gameId: "g-1",
    expectedPreviousVersion: 7,
    state: acceptedStateV8,
    playerEvents: acceptedEvents,
    auditEvents: acceptedAudit,
    updates: safeUpdates
  });
  const loaded = repo.load("g-1");
  expect(loaded?.state).toEqual(acceptedStateV8);
  expect(loaded?.auditEvents).toEqual(acceptedAudit);
});

it("rolls back the whole transition when one insert fails", () => {
  const repo = repositoryWithInjectedAuditFailure();
  expect(() => repo.appendTransition(fixtureTransition)).toThrow();
  expect(repo.load("g-1")?.state.version).toBe(7);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/persistence/test/sqlite-session-repository.test.ts`

Expected: FAIL because repository and schema are absent.

- [ ] **Step 3: Implement versioned migrations with built-in `node:sqlite`**

Create `schema_migrations`, `sessions`, `session_seats`, `player_events`, `audit_events`, `state_snapshots`, `session_updates`, and `model_calls`. Enable foreign keys and WAL. Store canonical JSON only after Zod/domain validation; add unique constraints for `(game_id, sequence)` and command identity.

- [ ] **Step 4: Implement optimistic transactional append**

Within one SQLite transaction, assert persisted session version equals `expectedPreviousVersion`, insert ordered events/audit/update rows, store the new state snapshot, and update session status/version. On mismatch throw `PersistenceConflictError` without partial writes.

- [ ] **Step 5: Test restart and corruption handling**

Close and reopen a temporary file database, then assert exact state/events return. Insert malformed JSON and non-contiguous sequence through a test-only raw connection and assert `load` fails closed rather than returning a partial session.

- [ ] **Step 6: Run verification**

Run: `pnpm vitest run packages/persistence/test/sqlite-session-repository.test.ts && pnpm test && pnpm typecheck && git diff --check`

- [ ] **Step 7: Commit**

```bash
git add packages/persistence package.json pnpm-lock.yaml
git commit -m "feat: persist local game sessions in sqlite"
```

---

### Task 4: Audit-Journal Recovery and Safe Update Replay

**Files:**
- Create: `packages/persistence/src/sqlite/update-log-repository.ts`
- Modify: `packages/persistence/src/sqlite/session-repository.ts`
- Modify: `packages/persistence/src/index.ts`
- Test: `packages/persistence/test/sqlite-recovery.test.ts`

**Interfaces:**
- Consumes: engine `restoreFromAuditJournal(initialState, auditEvents)` and Task 3 stored rows.
- Produces: `SessionRecoveryService.recover(gameId): RecoveredSession` and `readUpdatesAfter(gameId, sequence, mode): SessionUpdate[]`.

- [ ] **Step 1: Write failing recovery tests**

```ts
it("recovers accepted and rejected commands without duplicate execution", () => {
  const recovered = repo.recoverSession("g-1");
  expect(recovered.state).toEqual(finalState);
  expect(applyCommand(recovered.state, rejectedCommand)).toEqual({
    state: recovered.state,
    events: [],
    auditEvents: []
  });
});

it("never replays god updates to a public subscriber", () => {
  expect(repo.readUpdatesAfter("g-1", 0, { kind: "public" }))
    .not.toContainEqual(expect.objectContaining({ visibility: "god" }));
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/persistence/test/sqlite-recovery.test.ts`

- [ ] **Step 3: Implement fail-closed recovery**

Load the immutable initial snapshot and full ordered god audit journal, validate game/ruleset/sequence continuity, call `restoreFromAuditJournal`, and compare the result with the latest stored snapshot. If either source is missing or differs, mark the session `recovery_failed` and throw `SessionRecoveryError`.

- [ ] **Step 4: Implement audience-scoped update replay**

Persist distinct update payloads per `public`, `seat:<n>`, and `god` audience or regenerate from canonical events; never store a god payload and filter it with property deletion. `readUpdatesAfter` must validate each returned update with the audience-specific schema.

- [ ] **Step 5: Add missing/out-of-order/cross-game negative cases**

Prove recovery rejects a missing rejected-command commit, duplicate event sequence, swapped audit records, cross-game row, altered ruleset snapshot, and forged processed command ID.

- [ ] **Step 6: Run verification and commit**

Run: `pnpm vitest run packages/persistence/test/sqlite-recovery.test.ts && pnpm test && pnpm typecheck && git diff --check`

```bash
git add packages/persistence
git commit -m "feat: recover sessions from verified audit journals"
```

---

### Task 5: Player Controller and Deterministic Script Adapter

**Files:**
- Modify: `packages/application/src/ports.ts`
- Create: `packages/application/src/scripted-player-controller.ts`
- Modify: `packages/application/src/index.ts`
- Test: `packages/application/test/scripted-player-controller.test.ts`

**Interfaces:**
- Consumes: `LegalActionSnapshot`, safe `SeatView`, and current state version.
- Produces: `PlayerController.request(input, signal): Promise<PlayerDecision>` and deterministic `ScriptedPlayerController`.

- [ ] **Step 1: Write the failing controller contract tests**

```ts
it("cannot select an action absent from the frozen legal snapshot", async () => {
  const controller = new ScriptedPlayerController([{ type: "submit_vote", target: 6 }]);
  await expect(controller.request(inputAllowingOnlyPass, AbortSignal.timeout(100)))
    .rejects.toThrow("scripted_action_not_legal");
});

it("never receives another seat's private view", async () => {
  const input = controllerInputForSeat(2);
  expect(JSON.stringify(input.view)).not.toContain("seat-3-secret");
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/application/test/scripted-player-controller.test.ts`

- [ ] **Step 3: Define controller ports**

```ts
export interface PlayerController {
  request(input: PlayerRequest, signal: AbortSignal): Promise<PlayerDecision>;
}

export interface ControllerRegistry {
  get(seat: SeatId): PlayerController;
}
```

`PlayerRequest` contains only game/seat IDs, frozen version, safe seat view, task kind, legal actions, and speech budget. It cannot contain full state, god events, credentials, provider metadata, or another seat's private data.

- [ ] **Step 4: Implement the deterministic adapter**

Consume one scripted decision per request, validate it against the frozen snapshot, honor abort signals, and expose pending-request hooks for orchestration tests. Do not import the existing engine full-game runner into production application code.

- [ ] **Step 5: Run verification and commit**

Run: `pnpm vitest run packages/application/test/scripted-player-controller.test.ts && pnpm test && pnpm typecheck && git diff --check`

```bash
git add packages/application
git commit -m "feat: define application player controllers"
```

---

### Task 6: Single-Writer Session Runner

**Files:**
- Create: `packages/application/src/session-runner.ts`
- Modify: `packages/application/src/index.ts`
- Test: `packages/application/test/session-runner.test.ts`

**Interfaces:**
- Consumes: `SessionRepository`, `ControllerRegistry`, `GameUpdatePublisher`, engine `getLegalActions`/`applyCommand`, and Task 2 projector.
- Produces: `GameSessionRunner.start()`, `pause()`, `resume()`, `step()`, `stop()`, and `status()`.

- [ ] **Step 1: Write failing lifecycle and concurrency tests**

```ts
it("processes exactly one accepted command in step mode", async () => {
  await runner.step();
  expect(repo.load(gameId)?.state.version).toBe(initial.version + 1);
  expect(runner.status()).toEqual({ mode: "paused", inFlight: false });
});

it("serializes simultaneous resume calls", async () => {
  await Promise.all([runner.resume(), runner.resume(), runner.resume()]);
  expect(maximumConcurrentControllerCalls).toBe(1);
});
```

Also cover pause before a new call, abort during a call, stale response rejection, rejected-command persistence, terminal settlement stop, and mandatory-action failure pause.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/application/test/session-runner.test.ts`

- [ ] **Step 3: Implement an explicit pump, not a recursive loop**

Keep a single `pumpPromise`; controls update desired mode and schedule the pump only when absent. Each iteration loads canonical state, selects the next actor from legal snapshots in deterministic seat order, builds a safe request, freezes the version, awaits the controller, submits one command, persists one atomic transition, and publishes safe updates.

- [ ] **Step 4: Implement application-level failure mapping**

Scripted controller failures are classified as `controller_unavailable`, `invalid_decision`, `timeout`, or `cancelled`. This phase pauses on every controller failure; Task 3's real model plan will add speech/vote/skill-specific automatic degradation without changing the runner port.

- [ ] **Step 5: Run a complete good and wolf game through the runner**

Reuse command content from engine fixtures only as test data. Assert both sessions terminate within 300 processed commands, every persisted transition restores, all updates have monotonic sequences, and public updates never contain god fields.

- [ ] **Step 6: Run verification and commit**

Run: `pnpm vitest run packages/application/test/session-runner.test.ts && pnpm test && pnpm typecheck && git diff --check`

```bash
git add packages/application
git commit -m "feat: orchestrate deterministic local game sessions"
```

---

### Task 7: Fastify REST Session API and Registry

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/runtime/session-registry.ts`
- Create: `apps/server/src/routes/sessions.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Test: `apps/server/test/session-api.test.ts`

**Interfaces:**
- Consumes: Task 1 REST schemas, `SqliteSessionRepository`, `GameSessionRunner`, and controller registry factory.
- Produces: `buildServer(dependencies): FastifyInstance` and `/api/sessions` REST endpoints.

- [ ] **Step 1: Write failing injected Fastify API tests**

```ts
it("creates a fixed six-player session without accepting client roles", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: { seed: "demo-1", seats: scriptedSeatConfigs }
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().view.mode).toEqual({ kind: "public" });
  expect(JSON.stringify(response.json())).not.toContain("role_assigned");
});
```

Cover list/get, start/pause/resume/step, invalid body 400, missing session 404, recovery failure 409, and concurrent control idempotency.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/server/test/session-api.test.ts`

- [ ] **Step 3: Implement the registry and routes**

The registry owns at most one runner per game ID and rebuilds it from the repository after restart. Routes parse all bodies/params/results with Zod, return safe views only, and never serialize repository rows or engine state directly.

- [ ] **Step 4: Add local executable and graceful shutdown**

Read only non-secret settings `WFILL_HOST`, `WFILL_PORT`, and `WFILL_DATA_DIR`; default to `127.0.0.1`, `3210`, and `data/local`. On SIGINT/SIGTERM stop runners, close SSE subscribers and SQLite, then close Fastify.

- [ ] **Step 5: Run verification and commit**

Run: `pnpm vitest run apps/server/test/session-api.test.ts && pnpm test && pnpm typecheck && git diff --check`

```bash
git add apps/server package.json pnpm-lock.yaml pnpm-workspace.yaml vitest.config.ts
git commit -m "feat: expose local session control API"
```

---

### Task 8: SSE Safe Updates and Reconnection

**Files:**
- Create: `apps/server/src/routes/session-events.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/runtime/session-registry.ts`
- Test: `apps/server/test/session-sse.test.ts`

**Interfaces:**
- Consumes: `GameUpdatePublisher`, persisted safe session updates, `SpectatorMode`, and Last-Event-ID.
- Produces: `GET /api/sessions/:gameId/events?view=public|god|seat:<n>` SSE endpoint.

- [ ] **Step 1: Write failing streaming and reconnection tests**

```ts
it("replays only updates after Last-Event-ID for the requested audience", async () => {
  const events = await readSse(app, "/api/sessions/g-1/events?view=public", {
    "last-event-id": "7"
  }, 2);
  expect(events.map(event => event.id)).toEqual(["8", "9"]);
  expect(JSON.stringify(events)).not.toContain("elimination_cause_recorded");
});
```

Cover initial safe snapshot, live update, public/seat/god separation, heartbeat, disconnect cleanup, invalid view, unavailable replay range falling back to a new snapshot, and no duplicate sequence after reconnect.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/server/test/session-sse.test.ts`

- [ ] **Step 3: Implement persisted replay then live subscription**

Before attaching the subscriber, capture the latest persisted sequence; replay `(lastId, captured]`, subscribe, then discard any live item whose sequence is not greater than the last sent sequence. Format each event with `id`, `event`, and JSON `data`; send comment heartbeats without incrementing game sequence.

- [ ] **Step 4: Add backpressure and cleanup**

Use bounded per-subscriber queues. A slow subscriber is disconnected and must reconnect from Last-Event-ID; it may never block the session runner. Remove listeners on request abort and server shutdown.

- [ ] **Step 5: Run verification and commit**

Run: `pnpm vitest run apps/server/test/session-sse.test.ts && pnpm test && pnpm typecheck && git diff --check`

```bash
git add apps/server
git commit -m "feat: stream safe session updates over sse"
```

---

### Task 9: Phase Integration, Runtime Smoke Test, and Documentation

**Files:**
- Create: `apps/server/test/local-session.e2e.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-22-mvp-roadmap.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: every package and server endpoint from Tasks 1–8.
- Produces: a verified local backend baseline and documented commands for the model/prompt phase.

- [ ] **Step 1: Write a failing black-box session test**

Start the built server on an ephemeral port with a temporary SQLite file, create a six-seat scripted session over HTTP, subscribe to public and god SSE streams, run a complete game, restart the server, and assert:

```ts
expect(finalPublicView.outcome).toBe("good_win");
expect(JSON.stringify(publicTranscript)).not.toMatch(/poison|wolf_kill|role_assigned/);
expect(godTranscript).toContainEqual(expect.objectContaining({ kind: "death_detail" }));
expect(recoveredView).toEqual(finalPublicView);
```

- [ ] **Step 2: Verify RED before final wiring**

Run: `pnpm vitest run apps/server/test/local-session.e2e.test.ts`

Expected: FAIL until root scripts and executable packaging are complete.

- [ ] **Step 3: Add root scripts**

Provide `pnpm dev:server`, `pnpm build`, `pnpm start:server`, `pnpm test`, and `pnpm typecheck`. Build all packages in dependency order and run the built server without a TypeScript loader.

- [ ] **Step 4: Document truthful local backend usage**

README must say this phase uses scripted controllers and does not yet call real models or provide the React UI. Document install, test, start, health check, session creation/control, local data path, and deletion/reset instructions. Link the approved spec; add a model-gateway plan link only after that separate plan actually exists.

- [ ] **Step 5: Run final verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm vitest run apps/server/test/local-session.e2e.test.ts
pnpm test:raw-package-import
git diff --check
git status --short
```

Expected: all commands exit 0; working tree contains only the intended Task 9 files before commit.

- [ ] **Step 6: Commit**

```bash
git add README.md package.json apps/server/test/local-session.e2e.test.ts docs/superpowers/plans/2026-08-22-mvp-roadmap.md
git commit -m "test: verify recoverable local game sessions"
```

---

## Phase Completion Gate

Before writing or executing the OpenAI-Compatible model/prompt plan:

1. Run an independent whole-branch review from this plan's merge base.
2. Resolve every Critical and Important finding; record Minor findings explicitly.
3. Prove the built Node server can complete and restore both good and wolf scripted games without TS runtime transforms.
4. Prove public/seat/god permission matrices at both application and HTTP/SSE boundaries.
5. Preserve the work as a mergeable feature branch; integration remains the user's choice.
