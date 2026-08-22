# Rule Engine Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, API-free TypeScript rule engine that can validate and complete the approved six-player no-sheriff game through scripted commands.

**Architecture:** A pnpm workspace separates runtime contracts, reusable rules, and the pure game engine. Commands are validated before a reducer emits immutable events and a new state; the engine has no UI, database, clock, network, or model-provider dependency.

**Tech Stack:** Node.js 22 LTS, TypeScript, pnpm workspace, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-08-22-ai-werewolf-design.md`

## Global Constraints

- All code comments must be written in Chinese.
- The first playable ruleset is `six-player-classic-no-sheriff@1.0.0`.
- The roster is two werewolves, two villagers, one seer, and one witch.
- The game is no-sheriff, hidden-role, and elimination-of-all-good-players for wolves.
- Game logic must not depend on wall-clock time, UI state, model APIs, or database behavior.
- Players are identified in game logic only by `SeatId`; model/provider names do not enter domain state.
- Commands express intent; only emitted events represent accepted facts.
- Tests must use fixed seeds and exact expected events.
- No real API key may enter source files, fixtures, logs, or commits.

---

## Planned File Structure

```text
package.json                         # root scripts and tool versions
pnpm-workspace.yaml                  # workspace package discovery
tsconfig.base.json                   # strict shared TypeScript settings
vitest.workspace.ts                  # test projects
packages/contracts/                  # Zod schemas and public protocol types
  src/ids.ts
  src/commands.ts
  src/events.ts
  src/index.ts
packages/rules-core/                 # role, ability, ruleset and rule validation
  src/roles/base-roles.ts
  src/rulesets/six-player.ts
  src/validate-ruleset.ts
  src/index.ts
packages/game-engine/                # pure state machine and reducer
  src/state/game-state.ts
  src/setup/create-game.ts
  src/engine/apply-command.ts
  src/engine/legal-actions.ts
  src/engine/night-resolution.ts
  src/engine/vote-resolution.ts
  src/engine/victory.ts
  src/index.ts
  test/                              # focused unit and full-game tests
```

## Task 1: Workspace and Runtime Contracts

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/ids.ts`
- Create: `packages/contracts/src/commands.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Produces: branded `GameId`, `CommandId`, `EventId`, and integer `SeatId` schemas.
- Produces: `GameCommandSchema`, `GameCommand`, `GameEventSchema`, and `GameEvent` discriminated unions.
- Consumes: no project code.

- [ ] **Step 1: Write the failing protocol tests**

```ts
import { describe, expect, it } from "vitest";
import { GameCommandSchema, SeatIdSchema } from "../src/index.js";

describe("runtime contracts", () => {
  it("rejects seat zero", () => {
    expect(() => SeatIdSchema.parse(0)).toThrow();
  });

  it("parses a structured vote command", () => {
    const command = GameCommandSchema.parse({
      commandId: "cmd-1",
      gameId: "game-1",
      expectedVersion: 4,
      actorSeat: 2,
      type: "submit_vote",
      targetSeat: 3,
    });
    expect(command.type).toBe("submit_vote");
  });
});
```

- [ ] **Step 2: Run the test and verify the workspace is not yet runnable**

Run: `pnpm --filter @wfill/contracts test`

Expected: FAIL because the root workspace and contract exports do not exist.

- [ ] **Step 3: Create the strict workspace and minimal schemas**

Define `SeatIdSchema` as `z.number().int().min(1).max(24)`. Define a discriminated `GameCommandSchema` covering `submit_speech`, `submit_vote`, `submit_wolf_kill`, `inspect_player`, `use_antidote`, `use_poison`, `self_destruct`, and `pass_action`. Every command carries `commandId`, `gameId`, `expectedVersion`, and `actorSeat`.

Define `GameEventSchema` with the shared envelope and initial event types `game_created`, `role_assigned`, `phase_advanced`, `speech_published`, `vote_accepted`, `action_rejected`, and `game_finished`. Use `z.infer` for exported TypeScript types; do not duplicate interfaces manually.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @wfill/contracts test && pnpm typecheck`

Expected: all contract tests pass and TypeScript exits with code 0.

- [ ] **Step 5: Commit the protocol foundation**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts packages/contracts
git commit -m "feat: add game command and event contracts"
```

## Task 2: Versioned Roles and Ruleset Validation

**Files:**
- Create: `packages/rules-core/package.json`
- Create: `packages/rules-core/tsconfig.json`
- Create: `packages/rules-core/src/types.ts`
- Create: `packages/rules-core/src/roles/base-roles.ts`
- Create: `packages/rules-core/src/rulesets/six-player.ts`
- Create: `packages/rules-core/src/validate-ruleset.ts`
- Create: `packages/rules-core/src/index.ts`
- Test: `packages/rules-core/test/six-player-ruleset.test.ts`

**Interfaces:**
- Consumes: `SeatId` from `@wfill/contracts` only where a runtime seat is required; static role definitions remain seat-independent.
- Produces: `RoleDefinition`, `RulesetDefinition`, `SIX_PLAYER_RULESET`, and `validateRuleset(ruleset): RulesetValidationResult`.

- [ ] **Step 1: Write failing ruleset tests**

```ts
import { describe, expect, it } from "vitest";
import { SIX_PLAYER_RULESET, validateRuleset } from "../src/index.js";

describe("six-player ruleset", () => {
  it("contains exactly six approved roles and no sheriff", () => {
    expect(SIX_PLAYER_RULESET.roster).toEqual([
      "werewolf", "werewolf", "villager", "villager", "seer", "witch",
    ]);
    expect(SIX_PLAYER_RULESET.sheriff.enabled).toBe(false);
  });

  it("passes static validation", () => {
    expect(validateRuleset(SIX_PLAYER_RULESET)).toEqual({ ok: true, errors: [] });
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @wfill/rules-core test`

Expected: FAIL because the rules package and exports do not exist.

- [ ] **Step 3: Implement immutable role and ruleset definitions**

Create role definitions for `villager`, `werewolf`, `seer`, and `witch`, while retaining approved catalog definitions for `hunter`, `wolf-king`, `white-wolf-king`, `idiot`, and `guard` without enabling them in the first roster. Freeze exported definitions.

`validateRuleset` must report exact errors for roster-size mismatch, unknown role ID, enabled sheriff in a six-player ruleset, missing victory condition, duplicate ruleset version key, and invalid speech limits.

- [ ] **Step 4: Run rules tests and the complete workspace suite**

Run: `pnpm --filter @wfill/rules-core test && pnpm test && pnpm typecheck`

Expected: all tests pass and typecheck exits with code 0.

- [ ] **Step 5: Commit the versioned rules package**

```bash
git add packages/rules-core
git commit -m "feat: add versioned roles and six-player ruleset"
```

## Task 3: Deterministic Game Setup and Phase State

**Files:**
- Create: `packages/game-engine/package.json`
- Create: `packages/game-engine/tsconfig.json`
- Create: `packages/game-engine/src/state/game-state.ts`
- Create: `packages/game-engine/src/setup/seeded-random.ts`
- Create: `packages/game-engine/src/setup/create-game.ts`
- Create: `packages/game-engine/src/index.ts`
- Test: `packages/game-engine/test/create-game.test.ts`

**Interfaces:**
- Consumes: `RulesetDefinition` and `SIX_PLAYER_RULESET` from `@wfill/rules-core`.
- Produces: `GameState`, `PlayerState`, `GamePhase`, and `createGame({ gameId, ruleset, seed }): CreateGameResult`.
- `CreateGameResult` contains `{ state: GameState; events: GameEvent[] }`.

- [ ] **Step 1: Write failing deterministic setup tests**

```ts
import { describe, expect, it } from "vitest";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import { createGame } from "../src/index.js";

describe("createGame", () => {
  it("assigns the same roles for the same seed", () => {
    const first = createGame({ gameId: "game-1", ruleset: SIX_PLAYER_RULESET, seed: "seed-a" });
    const second = createGame({ gameId: "game-2", ruleset: SIX_PLAYER_RULESET, seed: "seed-a" });
    expect(first.state.players.map((player) => player.roleId))
      .toEqual(second.state.players.map((player) => player.roleId));
  });

  it("starts at the first-night wolf discussion window", () => {
    const result = createGame({ gameId: "game-1", ruleset: SIX_PLAYER_RULESET, seed: "seed-a" });
    expect(result.state.phase).toBe("night_wolf_discussion");
    expect(result.state.version).toBe(result.events.length);
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @wfill/game-engine test -- create-game.test.ts`

Expected: FAIL because `createGame` is missing.

- [ ] **Step 3: Implement pure seeded setup**

Use an internal deterministic PRNG derived from the provided seed; do not use `Math.random()`. Create seats 1 through 6, shuffle a copied roster, initialize witch resources, identify wolf teammates in private state, emit `game_created` and six private `role_assigned` events, then advance to `night_wolf_discussion`.

- [ ] **Step 4: Run setup tests, suite, and typecheck**

Run: `pnpm --filter @wfill/game-engine test -- create-game.test.ts && pnpm test && pnpm typecheck`

Expected: deterministic setup tests pass and the workspace remains green.

- [ ] **Step 5: Commit deterministic setup**

```bash
git add packages/game-engine
git commit -m "feat: add deterministic game setup"
```

## Task 4: Command Validation and Night Resolution

**Files:**
- Create: `packages/game-engine/src/engine/legal-actions.ts`
- Create: `packages/game-engine/src/engine/apply-command.ts`
- Create: `packages/game-engine/src/engine/night-resolution.ts`
- Modify: `packages/game-engine/src/state/game-state.ts`
- Modify: `packages/game-engine/src/index.ts`
- Modify: `packages/contracts/src/events.ts`
- Test: `packages/game-engine/test/night-resolution.test.ts`
- Test: `packages/game-engine/test/command-validation.test.ts`

**Interfaces:**
- Consumes: `GameCommand`, `GameEvent`, and `GameState`.
- Produces: `getLegalActions(state, actorSeat): LegalAction[]`.
- Produces: `applyCommand(state, command): { state: GameState; events: GameEvent[] }`.
- Rejected commands produce one `action_rejected` event and no domain-state mutation except the monotonic event/version record.

- [ ] **Step 1: Write failing night and legality tests**

```ts
it("rejects a villager attempting to inspect", () => {
  const result = applyCommand(stateWithVillagerAt(2), inspectCommand(2, 3));
  expect(result.events.at(-1)?.type).toBe("action_rejected");
  expect(result.state.pendingEffects).toEqual([]);
});

it("prevents the witch from self-saving", () => {
  const state = nightStateWithWitchAtAndWolfTarget(4, 4);
  const result = applyCommand(state, antidoteCommand(4));
  expect(result.events.at(-1)).toMatchObject({ type: "action_rejected", reason: "witch_self_save_forbidden" });
});

it("resolves wolf kill, seer result, and one potion only after actions lock", () => {
  const result = playApprovedNightCommands(fixedNightState());
  expect(result.state.phase).toBe("dawn");
  expect(result.events.map((event) => event.type)).toContain("night_resolved");
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @wfill/game-engine test -- command-validation.test.ts night-resolution.test.ts`

Expected: FAIL because legality and night resolution are missing.

- [ ] **Step 3: Implement legal actions and pending effects**

Validate command ID uniqueness, expected version, actor survival, current action window, role ability, legal target, remaining resource, self-save prohibition, and one-potion-per-night. Collect wolf kill, inspection, antidote, and poison as pending actions. Lock and resolve only after every required actor has submitted or passed.

Two wolves choosing different targets receive one final-confirmation window; a second disagreement produces an empty kill. Emit private inspection and wolf-decision events with explicit audience tags.

- [ ] **Step 4: Run night tests and full verification**

Run: `pnpm --filter @wfill/game-engine test -- command-validation.test.ts night-resolution.test.ts && pnpm test && pnpm typecheck`

Expected: all night, contract, and rules tests pass.

- [ ] **Step 5: Commit night resolution**

```bash
git add packages/game-engine packages/contracts
git commit -m "feat: validate and resolve night actions"
```

## Task 5: Day Speech, Simultaneous Voting, and PK

**Files:**
- Create: `packages/game-engine/src/engine/vote-resolution.ts`
- Create: `packages/game-engine/src/engine/speech-policy.ts`
- Modify: `packages/game-engine/src/engine/apply-command.ts`
- Modify: `packages/game-engine/src/state/game-state.ts`
- Modify: `packages/contracts/src/events.ts`
- Test: `packages/game-engine/test/day-voting.test.ts`
- Test: `packages/game-engine/test/speech-policy.test.ts`

**Interfaces:**
- Produces: `validateSpeech(text, limit): SpeechValidationResult`.
- Produces: `resolveVoteRound(state): VoteResolution`.
- Vote state contains a frozen `roundVersion`, eligible voters, candidates, hidden pending ballots, and round kind `exile | pk`.

- [ ] **Step 1: Write failing speech and voting tests**

```ts
it("rejects ordinary speech above 220 Chinese characters", () => {
  expect(validateSpeech("狼".repeat(221), 220)).toEqual({
    ok: false,
    reason: "speech_too_long",
    actualLength: 221,
    limit: 220,
  });
});

it("does not expose pending ballots before the round closes", () => {
  const next = applyCommand(openVoteState(), voteCommand(1, 3)).state;
  expect(next.publicVoteResult).toBeNull();
});

it("opens a PK round on first tie and skips exile on second tie", () => {
  const first = resolveVoteRound(firstTieState([2, 3]));
  expect(first.kind).toBe("open_pk");
  const second = resolveVoteRound(secondTieState([2, 3]));
  expect(second.kind).toBe("no_exile");
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @wfill/game-engine test -- speech-policy.test.ts day-voting.test.ts`

Expected: FAIL because speech and vote policies are missing.

- [ ] **Step 3: Implement deterministic day progression**

Create deterministic speaking order from seed, prior deaths, adjacent surviving seats, and direction. Enforce scenario-specific speech limits. Freeze vote inputs at round start; store ballots privately; close on all submissions or explicit timeout commands; reveal all ballots in one event.

On first tie, only tied candidates speak and non-tied eligible players vote. On second tie, emit `vote_tied_no_exile` and advance to night. A unique highest vote opens exile settlement and an eligible last-words window.

- [ ] **Step 4: Run voting tests and full verification**

Run: `pnpm --filter @wfill/game-engine test -- speech-policy.test.ts day-voting.test.ts && pnpm test && pnpm typecheck`

Expected: speech limits, hidden ballots, PK, and no-exile behavior all pass.

- [ ] **Step 5: Commit day and voting rules**

```bash
git add packages/game-engine packages/contracts
git commit -m "feat: add deterministic speech and voting flow"
```

## Task 6: Death, Last Words, Self-Destruct, and Victory

**Files:**
- Create: `packages/game-engine/src/engine/death-resolution.ts`
- Create: `packages/game-engine/src/engine/victory.ts`
- Modify: `packages/game-engine/src/engine/apply-command.ts`
- Modify: `packages/game-engine/src/state/game-state.ts`
- Modify: `packages/contracts/src/events.ts`
- Test: `packages/game-engine/test/death-and-victory.test.ts`

**Interfaces:**
- Produces: `resolveDeaths(state, effects): DeathResolutionResult` with explicit `DeathCause`.
- Produces: `evaluateVictory(state): VictoryResult` where result is `ongoing | good_win | wolf_win`.
- Produces: last-word eligibility derived from day number, death phase, and ruleset.

- [ ] **Step 1: Write failing settlement tests**

```ts
it("grants last words to first-night deaths but not later night deaths", () => {
  expect(lastWordsEligibility(firstNightDeath())).toBe(true);
  expect(lastWordsEligibility(secondNightDeath())).toBe(false);
});

it("ends with a good win after the final wolf is eliminated", () => {
  expect(evaluateVictory(stateWithNoLivingWolves())).toMatchObject({ status: "good_win" });
});

it("allows ordinary-wolf self-destruct only before voting", () => {
  expect(applyCommand(daySpeechStateWithWolf(), selfDestructCommand()).events.at(-1)?.type)
    .toBe("player_eliminated");
  expect(applyCommand(openVoteStateWithWolf(), selfDestructCommand()).events.at(-1)?.type)
    .toBe("action_rejected");
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @wfill/game-engine test -- death-and-victory.test.ts`

Expected: FAIL because death and victory modules are missing.

- [ ] **Step 3: Implement explicit settlement rules**

Represent death causes as `wolf_kill`, `exile`, `poison`, and `self_destruct` in the first ruleset while keeping the union extensible. Apply antidote before final death creation, allow poison to bypass rescue, and evaluate victory only after the current effect batch settles.

Implement first-night and daytime last words, the 30-character self-destruct last words rule, good victory when no wolf lives, and wolf victory when no good player lives. AI claims never invoke these functions.

- [ ] **Step 4: Run settlement tests and full verification**

Run: `pnpm --filter @wfill/game-engine test -- death-and-victory.test.ts && pnpm test && pnpm typecheck`

Expected: all death, last-word, self-destruct, and victory tests pass.

- [ ] **Step 5: Commit settlement behavior**

```bash
git add packages/game-engine packages/contracts
git commit -m "feat: settle deaths and victory conditions"
```

## Task 7: Legal-Action Snapshot and Engine Invariants

**Files:**
- Modify: `packages/game-engine/src/engine/legal-actions.ts`
- Create: `packages/game-engine/src/engine/assert-invariants.ts`
- Test: `packages/game-engine/test/legal-actions.test.ts`
- Test: `packages/game-engine/test/invariants.test.ts`

**Interfaces:**
- `getLegalActions` returns complete structured choices suitable for a future AI prompt or human UI.
- Produces: `assertGameState(state): void`, called after setup and every accepted command in non-production tests.

- [ ] **Step 1: Write failing invariant and legal-action tests**

```ts
it("never offers dead players speech or vote actions", () => {
  expect(getLegalActions(stateWithDeadSeat(3), 3)).toEqual([]);
});

it("offers the witch only unused and currently legal potion actions", () => {
  expect(getLegalActions(witchAfterAntidoteState(), 4).map((item) => item.type))
    .toEqual(["use_poison", "pass_action"]);
});

it("rejects a state with duplicate seat numbers", () => {
  expect(() => assertGameState(stateWithDuplicateSeats())).toThrow("duplicate_seat");
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @wfill/game-engine test -- legal-actions.test.ts invariants.test.ts`

Expected: FAIL because complete snapshots and invariants are missing.

- [ ] **Step 3: Implement exhaustive legal choices and assertions**

Legal action objects must include action type, target requirement, legal targets, whether pass is allowed, and speech limit. Assert unique seats, exact six-seat roster, monotonic version, valid phase, nonnegative resources, living action actors, and no duplicate command IDs.

- [ ] **Step 4: Run focused tests and complete verification**

Run: `pnpm --filter @wfill/game-engine test -- legal-actions.test.ts invariants.test.ts && pnpm test && pnpm typecheck`

Expected: all legal-action and invariant tests pass.

- [ ] **Step 5: Commit engine invariants**

```bash
git add packages/game-engine
git commit -m "test: enforce game engine invariants"
```

## Task 8: Scripted Full-Game Acceptance Harness

**Files:**
- Create: `packages/game-engine/src/testing/scripted-controller.ts`
- Create: `packages/game-engine/test/fixtures/good-win-script.ts`
- Create: `packages/game-engine/test/fixtures/wolf-win-script.ts`
- Create: `packages/game-engine/test/full-game.test.ts`
- Modify: `packages/game-engine/src/index.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `runScriptedGame({ seed, commands }): ScriptedGameResult`.
- `ScriptedGameResult` contains final state, ordered events, consumed command count, and invariant-check count.

- [ ] **Step 1: Write failing full-game acceptance tests**

```ts
describe("scripted full games", () => {
  it("reaches a deterministic good victory", () => {
    const result = runScriptedGame(GOOD_WIN_SCRIPT);
    expect(result.finalState.phase).toBe("finished");
    expect(result.finalState.winner).toBe("good");
    expect(result.events.at(-1)?.type).toBe("game_finished");
  });

  it("reaches a deterministic wolf victory", () => {
    const result = runScriptedGame(WOLF_WIN_SCRIPT);
    expect(result.finalState.phase).toBe("finished");
    expect(result.finalState.winner).toBe("wolf");
  });
});
```

- [ ] **Step 2: Run the acceptance test and verify failure**

Run: `pnpm --filter @wfill/game-engine test -- full-game.test.ts`

Expected: FAIL because the scripted harness and fixtures do not exist.

- [ ] **Step 3: Implement the script runner and two complete fixtures**

The runner must request current legal actions before each command, reject scripts that attempt an unavailable action, apply commands one at a time, assert invariants after each accepted command, and stop only at `finished` or an explicit maximum of 300 commands.

Document the API-free verification command in `README.md` and label it as simulated rules-engine proof, not real AI evidence.

- [ ] **Step 4: Run all phase-one quality gates**

Run: `pnpm test && pnpm typecheck`

Expected: every package passes, both scripted games finish with exact winners, and TypeScript reports zero errors.

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the intended phase-one files are modified before commit.

- [ ] **Step 5: Commit the complete phase-one slice**

```bash
git add README.md packages
git commit -m "test: verify complete scripted six-player games"
```

## Phase-One Acceptance Gate

Before moving to event storage, projections, or model APIs, verify all of the following with fresh command output:

- `pnpm test` exits 0.
- `pnpm typecheck` exits 0.
- The deterministic good-win fixture finishes with `winner=good`.
- The deterministic wolf-win fixture finishes with `winner=wolf`.
- Illegal role, phase, target, duplicate, stale-version, and overlong-speech commands are rejected.
- Pending votes remain hidden until the round closes.
- The engine imports no HTTP, database, UI, model-provider, or credential module.
- `git status --short` is clean after the final commit.
