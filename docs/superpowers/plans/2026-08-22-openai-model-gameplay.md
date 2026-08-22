# OpenAI-Compatible Model Gameplay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace optional scripted seats with real OpenAI-Compatible text-model controllers so six configured models can safely complete and restore a local six-player game.

**Architecture:** Add a provider-neutral model gateway package, a prompt/decision adapter in the application layer, and SQLite-backed non-secret model configuration. The local Fastify server reads the API key only through an environment credential vault, exposes safe health/configuration endpoints, and preserves the deterministic engine as the only game-state authority.

**Tech Stack:** TypeScript, Node.js 22 native `fetch`, Zod, Fastify, SQLite, Vitest

**Spec:** `docs/superpowers/specs/2026-08-22-local-ai-gameplay-design.md`

## Global Constraints

- Provider endpoint is `http://aigw.dlut.edu.cn/v1`; chat calls use `POST /chat/completions` with `Authorization: Bearer`.
- The key is read from `WFILL_SCHOOL_API_KEY`; it never enters Git, SQLite, logs, events, prompts, HTTP responses, or thrown error messages.
- Initial enabled catalog contains only `Qwen3.5-9B`, `Qwen3.5-35B-A3B`, `Qwen3.5-122B-A10B`, `DeepSeek-V3.1-W8A8`, `GLM-4.6-W8A8`, `MiniMax-M2.7-bf16`, and `Qwen3-235B-A22B`.
- Embedding, reranking, OCR, visual-language, coder, and explicit thinking models are excluded from playable seats.
- Models receive only the requesting seat's legal view and use seat numbers, never provider/model names, inside game content.
- Models are never asked to reveal reasoning. Only final speech or a validated structured action is accepted.
- The rule engine remains pure and is the sole authority for roles, skills, voting, deaths, and victory.
- Real-network tests are opt-in through `WFILL_RUN_LIVE_MODEL_TESTS=1`; ordinary tests never spend API quota.
- All production code comments are Chinese.
- Every task follows RED/GREEN TDD, full regression, typecheck, build, `git diff --check`, and one focused commit.

---

## File Structure

```text
packages/model-gateway/
  src/contracts.ts                    # Normalized requests, results and errors
  src/openai-compatible-client.ts     # Fetch, timeout, response normalization
  src/model-catalog.ts                # Approved playable model catalog
  src/env-credential-vault.ts         # Secret lookup without persistence
  src/index.ts
  test/openai-compatible-client.test.ts
  test/env-credential-vault.test.ts

packages/application/
  src/model/prompt-builder.ts          # Versioned legal-view prompt
  src/model/decision-parser.ts         # Strict final-output parser
  src/model/model-player-controller.ts # Gateway-backed PlayerController
  src/model/failure-policy.ts          # Retry and deterministic degradation
  test/prompt-builder.test.ts
  test/model-player-controller.test.ts
  test/model-failure-policy.test.ts

packages/persistence/
  src/sqlite/model-repository.ts       # Non-secret accounts/models/call metadata
  test/sqlite-model-repository.test.ts

apps/server/
  src/routes/models.ts                 # Safe catalog and health endpoints
  src/runtime/model-controller-factory.ts
  src/runtime/session-registry.ts      # Scripted or model controller selection
  test/model-api.test.ts
  test/model-session.test.ts
  test/live-model.test.ts
```

---

### Task 1: Model Contracts, Approved Catalog, and Environment Credential Vault

**Files:**
- Create: `packages/model-gateway/package.json`
- Create: `packages/model-gateway/tsconfig.json`
- Create: `packages/model-gateway/src/contracts.ts`
- Create: `packages/model-gateway/src/model-catalog.ts`
- Create: `packages/model-gateway/src/env-credential-vault.ts`
- Create: `packages/model-gateway/src/index.ts`
- Test: `packages/model-gateway/test/env-credential-vault.test.ts`
- Modify: `package.json`, `pnpm-workspace.yaml`, `vitest.config.ts`

**Interfaces:**
- Produces `ModelAccount`, `PlayableModel`, `ModelCallRequest`, `ModelCallResult`, `ModelGatewayError`, `CredentialVault`, `APPROVED_PLAYABLE_MODELS`, and `EnvCredentialVault`.

- [ ] **Step 1: Write failing contract and secret-boundary tests**

```ts
expect(APPROVED_PLAYABLE_MODELS.map(model => model.id)).toEqual([
  "Qwen3.5-9B", "Qwen3.5-35B-A3B", "Qwen3.5-122B-A10B",
  "DeepSeek-V3.1-W8A8", "GLM-4.6-W8A8", "MiniMax-M2.7-bf16", "Qwen3-235B-A22B",
]);
expect(new EnvCredentialVault({ WFILL_SCHOOL_API_KEY: "secret" }).get("school-key"))
  .toBe("secret");
expect(JSON.stringify(new EnvCredentialVault({ WFILL_SCHOOL_API_KEY: "secret" })))
  .not.toContain("secret");
```

- [ ] **Step 2: Run `pnpm vitest run packages/model-gateway/test/env-credential-vault.test.ts` and verify missing-package RED**
- [ ] **Step 3: Implement strict Zod contracts, the exact seven-model catalog, and a vault that recognizes only `school-key → WFILL_SCHOOL_API_KEY`**
- [ ] **Step 4: Add package build/typecheck/test discovery and verify focused test, `pnpm test`, and `pnpm typecheck`**
- [ ] **Step 5: Commit `feat: define model gateway contracts and catalog`**

---

### Task 2: OpenAI-Compatible HTTP Client

**Files:**
- Create: `packages/model-gateway/src/openai-compatible-client.ts`
- Modify: `packages/model-gateway/src/index.ts`
- Test: `packages/model-gateway/test/openai-compatible-client.test.ts`

**Interfaces:**
- Consumes `CredentialVault.get(credentialRef)` and injected `fetch`.
- Produces `OpenAiCompatibleClient.listModels`, `checkModel`, `generate`, and `cancel`.

- [ ] **Step 1: Write a failing local-HTTP-server test asserting URL, Bearer header, model, messages, `temperature`, `max_tokens`, timeout, and no key in returned/errors**
- [ ] **Step 2: Add response cases for normal `choices[0].message.content`, fenced JSON, missing content, malformed JSON, 401, 404, 429, quota 402/403, 5xx, timeout, abort, and token usage**
- [ ] **Step 3: Run focused test and verify `OpenAiCompatibleClient` is absent**
- [ ] **Step 4: Implement native-fetch calls with base URL normalization, `AbortSignal.any`, bounded response reading, and normalized error codes `auth|model_not_found|quota|rate_limit|timeout|network|invalid_response|empty|cancelled|unknown`**
- [ ] **Step 5: Verify the focused matrix, full suite, typecheck, build, and commit `feat: call openai compatible model APIs`**

---

### Task 3: Versioned Prompt Builder

**Files:**
- Create: `packages/application/src/model/prompt-builder.ts`
- Modify: `packages/application/src/index.ts`
- Test: `packages/application/test/prompt-builder.test.ts`

**Interfaces:**
- Consumes `PlayerRequest` containing the legal seat-scoped `GameView`.
- Produces `buildModelPrompt(request): { version: "werewolf-player-v1"; messages; maxOutputTokens; responseKind }`.

- [ ] **Step 1: Write failing snapshots for public speech, wolf chat, seer inspection, witch action, voting, and last words**
- [ ] **Step 2: Assert every prompt says “只输出最终答案，不展示分析过程”, identifies only `N号`, includes exact legal targets, and never contains `provider`, `modelId`, API key, god-only facts, or another seat's private role**
- [ ] **Step 3: Assert untrusted prior speeches are delimited as quoted game records and cannot override the system task**
- [ ] **Step 4: Implement compact Chinese templates with structured facts before transcript; speech hard limits come from `speechBudget`, actions demand one JSON object**
- [ ] **Step 5: Verify tests and commit `feat: build safe werewolf player prompts`**

---

### Task 4: Strict Decision Parser and Model Player Controller

**Files:**
- Create: `packages/application/src/model/decision-parser.ts`
- Create: `packages/application/src/model/model-player-controller.ts`
- Modify: `packages/application/src/index.ts`
- Test: `packages/application/test/model-player-controller.test.ts`

**Interfaces:**
- Produces `parseModelDecision(text, request): PlayerDecision` and `ModelPlayerController implements PlayerController`.

- [ ] **Step 1: Write failing tests for plain speech plus action JSON forms such as `{\"action\":\"submit_vote\",\"targetSeat\":4}`**
- [ ] **Step 2: Add negative tests for prose around JSON, multiple objects, illegal action type, illegal target, self-vote, missing target, role-forbidden skill, empty speech, and over-budget speech**
- [ ] **Step 3: Verify RED, then implement extraction of exactly one final JSON object and validate against the frozen legal-action snapshot**
- [ ] **Step 4: Implement controller composition: prompt → gateway → parser; never expose raw request/response through the controller error**
- [ ] **Step 5: Verify focused/full gates and commit `feat: control seats with validated model decisions`**

---

### Task 5: Retry, Compression, and Deterministic Failure Policy

**Files:**
- Create: `packages/application/src/model/failure-policy.ts`
- Modify: `packages/application/src/model/model-player-controller.ts`
- Modify: `packages/application/src/session-runner.ts`
- Test: `packages/application/test/model-failure-policy.test.ts`

**Interfaces:**
- Produces `executeWithModelPolicy(input): ModelControllerOutcome` with retry metadata and either decision, deterministic fallback, or mandatory-action pause.

- [ ] **Step 1: Write fake-clock tests proving transient network/rate-limit/5xx errors retry at most twice with bounded exponential delays**
- [ ] **Step 2: Prove invalid JSON gets one format-only repair request; overlong speech gets one compression request then sentence-boundary truncation**
- [ ] **Step 3: Prove final failures map to speech skip, vote abstention, optional-skill pass, while wolf kill and other mandatory actions pause the runner**
- [ ] **Step 4: Implement policy without sleeping inside engine/persistence code and emit a safe application failure record for every fallback**
- [ ] **Step 5: Verify no retry for auth/model-not-found/quota/cancelled, then full gates and commit `feat: degrade failed model turns deterministically`**

---

### Task 6: Persist Non-Secret Model Configuration and Call Metadata

**Files:**
- Modify: `packages/persistence/src/sqlite/migrations.ts`
- Create: `packages/persistence/src/sqlite/model-repository.ts`
- Modify: `packages/persistence/src/index.ts`
- Test: `packages/persistence/test/sqlite-model-repository.test.ts`

**Interfaces:**
- Produces `SqliteModelRepository.upsertAccount`, `replaceModels`, `listPlayableModels`, `recordCall`, and `listCallsForGame`.

- [ ] **Step 1: Write migration/reopen tests for `model_accounts`, `account_models`, `session_seat_models`, and `model_calls`**
- [ ] **Step 2: Assert stored rows include only account/display/model/health/call timing/token/error metadata and recursively contain no API key, authorization header, prompts, messages, or raw response**
- [ ] **Step 3: Implement migration v2 and transactional repository with stable `school-account` / `school-key` references**
- [ ] **Step 4: Add atomic call-metadata persistence to session transitions without making a failed metrics write alter an already committed engine command**
- [ ] **Step 5: Verify corruption and restart handling, full gates, and commit `feat: persist safe model configuration and usage`**

---

### Task 7: Safe Model Catalog and Health REST API

**Files:**
- Create: `apps/server/src/routes/models.ts`
- Create: `apps/server/src/runtime/model-runtime.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/model-api.test.ts`

**Interfaces:**
- Produces `GET /api/models`, `POST /api/models/:modelId/check`, and `POST /api/models/check-all`.

- [ ] **Step 1: Write injected API tests proving the catalog exposes seven IDs, enabled/health state, and only a `configured` boolean for credentials**
- [ ] **Step 2: Add fake-gateway health cases for healthy, auth failure, unavailable model, timeout, and malformed provider response**
- [ ] **Step 3: Implement environment bootstrapping from `WFILL_SCHOOL_API_BASE_URL` and `WFILL_SCHOOL_API_KEY`; missing key keeps server healthy but models unavailable**
- [ ] **Step 4: Ensure errors and Fastify logs cannot serialize secret-bearing headers or raw bodies**
- [ ] **Step 5: Verify tests and commit `feat: expose safe model health endpoints`**

---

### Task 8: Model-Bound Session Creation and Recovery

**Files:**
- Create: `apps/server/src/runtime/model-controller-factory.ts`
- Modify: `apps/server/src/runtime/session-registry.ts`
- Modify: `apps/server/src/routes/sessions.ts`
- Test: `apps/server/test/model-session.test.ts`

**Interfaces:**
- Extends session creation with `{ controller: "models", seats: [{ seat: 1..6, accountId: "school-account", modelId }] }`; retains `{ seed: "good-win"|"wolf-win" }` scripted test mode.

- [ ] **Step 1: Write failing tests rejecting missing/duplicate seats, disabled/unhealthy/unknown models, role input, provider labels, and credential fields**
- [ ] **Step 2: Prove six seats may reuse one model or mix models and that game events/views contain seat numbers but no model/provider identity**
- [ ] **Step 3: Implement controller factory and persist an immutable non-secret seat-model display snapshot outside engine state**
- [ ] **Step 4: Prove restart rebuilds controllers from seat bindings, does not replay processed commands, and pauses cleanly if the credential is now unavailable**
- [ ] **Step 5: Verify scripted regression plus model-session tests and commit `feat: create sessions with selectable api models`**

---

### Task 9: Opt-In Live Gateway and Complete-Game Acceptance

**Files:**
- Create: `apps/server/test/live-model.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-22-mvp-roadmap.md`
- Modify: `package.json`

**Interfaces:**
- Produces `pnpm test:live-model` and documented local commands; no live call runs under ordinary `pnpm test`.

- [ ] **Step 1: Write a skipped-by-default live health test that requires `WFILL_RUN_LIVE_MODEL_TESTS=1` and checks one low-cost model without printing content or key**
- [ ] **Step 2: Add an opt-in six-seat complete-game test using a configurable subset of healthy models, a 300-command ceiling, per-call timeout, and hard total token/call ceilings**
- [ ] **Step 3: Add a dry-run fake-provider black-box test covering speech, wolf discussion, skills, votes, retry, fallback, public/god SSE privacy, settlement, and restart**
- [ ] **Step 4: Document `.env`, the exact seven models, health check, model-bound session JSON, live-test opt-in, quota cautions, and the fact that UI remains the next phase**
- [ ] **Step 5: Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:raw-package-import`, `git diff --check`, and a secret scan excluding `.env`**
- [ ] **Step 6: With user key present, run only the low-cost health test first; run a complete live game only after health passes and report model IDs, call counts, latency, tokens, outcome, and failures without raw content**
- [ ] **Step 7: Commit `test: verify real model gameplay pipeline`**

---

## Phase Completion Gate

1. Ordinary tests spend zero API quota and pass without a key.
2. Git-tracked files, SQLite, logs, errors, REST, SSE, and replays contain no API key or Authorization header.
3. Fake-provider black-box tests complete and restore both model-driven good and wolf games.
4. The school gateway passes a low-cost health call for at least two selected text models.
5. At least one opt-in six-model game reaches deterministic settlement within configured call/token ceilings.
6. Public, seat, and god projections remain unchanged except for safe game content; none contains model/provider identity or hidden prompts.
7. Preserve the work as a reviewable feature branch before merging.
