import type { RulesetDefinition } from "../types.js";

export const SIX_PLAYER_RULESET: RulesetDefinition = Object.freeze({
  id: "six-player-classic-no-sheriff",
  version: "1.0.0",
  playerCount: 6,
  roster: Object.freeze([
    "werewolf",
    "werewolf",
    "villager",
    "villager",
    "seer",
    "witch",
  ]),
  sheriff: Object.freeze({ enabled: false }),
  identityVisibility: "hidden",
  victoryConditions: Object.freeze([
    Object.freeze({
      id: "good_eliminates_wolves",
      winningFaction: "good",
      priority: 1,
      requirement: "all_opponents_eliminated",
    }),
    Object.freeze({
      id: "wolves_eliminate_good",
      winningFaction: "werewolf",
      priority: 1,
      requirement: "all_opponents_eliminated",
    }),
  ]),
  speechLimits: Object.freeze({
    wolfDiscussion: Object.freeze({ maxMessagesPerWolf: 2, maxCharacters: 100 }),
    ordinary: Object.freeze({
      recommendedMinCharacters: 80,
      recommendedMaxCharacters: 180,
      maxCharacters: 220,
    }),
    pk: Object.freeze({ maxCharacters: 150 }),
    lastWords: Object.freeze({
      firstNightMaxCharacters: 150,
      dayExileMaxCharacters: 150,
      selfDestructMaxCharacters: 30,
    }),
    abilityQuote: Object.freeze({ maxCharacters: 60 }),
  }),
  selfDestruct: Object.freeze({ enabled: true }),
});
