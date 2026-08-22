import { SIX_PLAYER_RULESET, type RulesetDefinition } from "@wfill/rules-core";

export type EngineRulesetCapability =
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: "exact_six_seats" | "unsupported_ruleset" };

/** 明确声明当前引擎能完整执行的规则集，避免只校验“看起来合法”却在流程中死锁。 */
export const validateEngineRuleset = (ruleset: RulesetDefinition): EngineRulesetCapability => {
  if (ruleset.playerCount !== 6 || ruleset.roster.length !== 6) {
    return { supported: false, reason: "exact_six_seats" };
  }
  const sameRoleMultiplicities = [...ruleset.roster].sort().join("|")
    === [...SIX_PLAYER_RULESET.roster].sort().join("|");
  if (
    ruleset.id !== SIX_PLAYER_RULESET.id
    || ruleset.version !== SIX_PLAYER_RULESET.version
    || ruleset.sheriff.enabled
    || !sameRoleMultiplicities
  ) return { supported: false, reason: "unsupported_ruleset" };
  return { supported: true };
};
