import { BASE_ROLES, SIX_PLAYER_RULESET, type RulesetDefinition } from "@wfill/rules-core";

export type EngineRulesetCapability =
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: "exact_six_seats" | "unsupported_ruleset" };

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
};

const semanticSignature = (ruleset: RulesetDefinition): string => JSON.stringify(canonicalize({
  ruleset,
  roles: Object.fromEntries([...new Set(ruleset.roster)]
    .sort()
    .map((roleId) => [roleId, BASE_ROLES[roleId as keyof typeof BASE_ROLES] ?? null])),
}));

const APPROVED_SIGNATURE = semanticSignature(SIX_PLAYER_RULESET);

/** 精确匹配已实现的完整语义，避免同 ID/版本偷换规则后进入未定义流程。 */
export const validateEngineRuleset = (ruleset: RulesetDefinition): EngineRulesetCapability => {
  if (ruleset.playerCount !== 6 || ruleset.roster.length !== 6) {
    return { supported: false, reason: "exact_six_seats" };
  }
  if (semanticSignature(ruleset) !== APPROVED_SIGNATURE) {
    return { supported: false, reason: "unsupported_ruleset" };
  }
  return { supported: true };
};
