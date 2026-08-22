import { BASE_ROLES } from "./roles/base-roles.js";
import type {
  RulesetDefinition,
  RulesetValidationResult,
  SpeechLimits,
} from "./types.js";

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

const hasValidSpeechLimits = (limits: SpeechLimits): boolean => {
  const ordinary = limits.ordinary;

  return (
    isPositiveInteger(limits.wolfDiscussion.maxMessagesPerWolf) &&
    isPositiveInteger(limits.wolfDiscussion.maxCharacters) &&
    isPositiveInteger(ordinary.recommendedMinCharacters) &&
    isPositiveInteger(ordinary.recommendedMaxCharacters) &&
    isPositiveInteger(ordinary.maxCharacters) &&
    ordinary.recommendedMinCharacters <= ordinary.recommendedMaxCharacters &&
    ordinary.recommendedMaxCharacters <= ordinary.maxCharacters &&
    isPositiveInteger(limits.pk.maxCharacters) &&
    isPositiveInteger(limits.lastWords.firstNightMaxCharacters) &&
    isPositiveInteger(limits.lastWords.dayExileMaxCharacters) &&
    isPositiveInteger(limits.lastWords.selfDestructMaxCharacters) &&
    isPositiveInteger(limits.abilityQuote.maxCharacters)
  );
};

const result = (errors: readonly string[]): RulesetValidationResult => ({
  ok: errors.length === 0,
  errors,
});

export const validateRuleset = (
  ruleset: RulesetDefinition,
): RulesetValidationResult => {
  const errors: string[] = [];

  if (ruleset.roster.length !== ruleset.playerCount) {
    errors.push("roster_size_mismatch");
  }

  for (const roleId of ruleset.roster) {
    if (!Object.hasOwn(BASE_ROLES, roleId)) {
      errors.push(`unknown_role_id:${roleId}`);
    }
  }

  if (ruleset.playerCount === 6 && ruleset.sheriff.enabled) {
    errors.push("sheriff_forbidden_for_six_player");
  }

  if (ruleset.victoryConditions.length === 0) {
    errors.push("missing_victory_condition");
  }

  if (!hasValidSpeechLimits(ruleset.speechLimits)) {
    errors.push("invalid_speech_limit");
  }

  return result(errors);
};

export const validateRulesetCatalog = (
  rulesets: readonly RulesetDefinition[],
): RulesetValidationResult => {
  const errors = rulesets.flatMap((ruleset) => validateRuleset(ruleset).errors);
  const versionKeys = new Set<string>();

  for (const ruleset of rulesets) {
    const versionKey = `${ruleset.id}@${ruleset.version}`;

    if (versionKeys.has(versionKey)) {
      errors.push(`duplicate_ruleset_version_key:${versionKey}`);
      continue;
    }

    versionKeys.add(versionKey);
  }

  return result(errors);
};
