export { createGame } from "./setup/create-game.js";
export type { CreateGameInput, CreateGameResult } from "./setup/create-game.js";
export { applyCommand } from "./engine/apply-command.js";
export type { ApplyCommandResult } from "./engine/apply-command.js";
export { getLegalActions } from "./engine/legal-actions.js";
export type { LegalAction } from "./engine/legal-actions.js";
export { assertGameState } from "./engine/assert-invariants.js";
export { resolveNight } from "./engine/night-resolution.js";
export type { NightResolutionResult } from "./engine/night-resolution.js";
export { lastWordsEligibility, resolveDeaths } from "./engine/death-resolution.js";
export type { DeathCause } from "@wfill/contracts";
export type {
  DeathPhase,
  DeathResolutionResult,
  Elimination,
  LastWordsEligibilityInput,
} from "./engine/death-resolution.js";
export { evaluateVictory } from "./engine/victory.js";
export type { VictoryResult } from "./engine/victory.js";
export { createSpeakingOrder, validateSpeech } from "./engine/speech-policy.js";
export type {
  SpeakingOrderInput,
  SpeechDirection,
  SpeechValidationResult,
} from "./engine/speech-policy.js";
export { resolveVoteRound } from "./engine/vote-resolution.js";
export type { VoteResolution } from "./engine/vote-resolution.js";
export type {
  GamePhase,
  GameOutcome,
  GameState,
  NightState,
  PendingEffect,
  PlayerPrivateState,
  PlayerState,
  PublicVoteResult,
  SpeechState,
  VoteBallot,
  VoteRoundState,
  VoteTallyEntry,
  WolfSubmission,
  WitchResources,
} from "./state/game-state.js";
