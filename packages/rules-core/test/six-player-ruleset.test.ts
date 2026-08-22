import { describe, expect, it } from "vitest";
import {
  BASE_ROLES,
  SIX_PLAYER_RULESET,
  validateRuleset,
  validateRulesetCatalog,
} from "../src/index.js";

describe("six-player ruleset", () => {
  it("contains exactly six approved roles and no sheriff", () => {
    expect(SIX_PLAYER_RULESET.roster).toEqual([
      "werewolf",
      "werewolf",
      "villager",
      "villager",
      "seer",
      "witch",
    ]);
    expect(SIX_PLAYER_RULESET.sheriff.enabled).toBe(false);
  });

  it("passes static validation", () => {
    expect(validateRuleset(SIX_PLAYER_RULESET)).toEqual({ ok: true, errors: [] });
  });

  it("keeps the approved role catalog and ruleset immutable", () => {
    expect(Object.keys(BASE_ROLES).sort()).toEqual([
      "guard",
      "hunter",
      "idiot",
      "seer",
      "villager",
      "werewolf",
      "white-wolf-king",
      "witch",
      "wolf-king",
    ]);
    expect(Object.isFrozen(BASE_ROLES)).toBe(true);
    expect(Object.isFrozen(BASE_ROLES.witch)).toBe(true);
    expect(Object.isFrozen(SIX_PLAYER_RULESET)).toBe(true);
    expect(Object.isFrozen(SIX_PLAYER_RULESET.roster)).toBe(true);
  });

  it("reports a roster size mismatch", () => {
    expect(
      validateRuleset({ ...SIX_PLAYER_RULESET, roster: ["werewolf"] }),
    ).toEqual({ ok: false, errors: ["roster_size_mismatch"] });
  });

  it("reports an unknown role ID", () => {
    expect(
      validateRuleset({
        ...SIX_PLAYER_RULESET,
        roster: ["werewolf", "werewolf", "villager", "villager", "seer", "unknown"],
      }),
    ).toEqual({ ok: false, errors: ["unknown_role_id:unknown"] });
  });

  it("forbids an enabled sheriff in a six-player ruleset", () => {
    expect(
      validateRuleset({
        ...SIX_PLAYER_RULESET,
        sheriff: { enabled: true },
      }),
    ).toEqual({ ok: false, errors: ["sheriff_forbidden_for_six_player"] });
  });

  it("reports a missing victory condition", () => {
    expect(
      validateRuleset({ ...SIX_PLAYER_RULESET, victoryConditions: [] }),
    ).toEqual({ ok: false, errors: ["missing_victory_condition"] });
  });

  it("reports an invalid speech limit", () => {
    expect(
      validateRuleset({
        ...SIX_PLAYER_RULESET,
        speechLimits: {
          ...SIX_PLAYER_RULESET.speechLimits,
          ordinary: {
            ...SIX_PLAYER_RULESET.speechLimits.ordinary,
            maxCharacters: 0,
          },
        },
      }),
    ).toEqual({ ok: false, errors: ["invalid_speech_limit"] });
  });

  it("reports a duplicate catalog version key", () => {
    expect(
      validateRulesetCatalog([
        SIX_PLAYER_RULESET,
        { ...SIX_PLAYER_RULESET },
      ]),
    ).toEqual({
      ok: false,
      errors: ["duplicate_ruleset_version_key:six-player-classic-no-sheriff@1.0.0"],
    });
  });
});
