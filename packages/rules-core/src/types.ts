export type Faction = "good" | "werewolf";

export interface RoleDefinition {
  readonly id: string;
  readonly version: string;
  readonly faction: Faction;
  readonly roleType: string;
  readonly abilityIds: readonly string[];
  readonly aiDescription: string;
}

export interface VictoryCondition {
  readonly id: string;
  readonly winningFaction: Faction;
  readonly priority: number;
  readonly requirement: "all_opponents_eliminated";
}

export interface SpeechLimits {
  readonly wolfDiscussion: {
    readonly maxMessagesPerWolf: number;
    readonly maxCharacters: number;
  };
  readonly ordinary: {
    readonly recommendedMinCharacters: number;
    readonly recommendedMaxCharacters: number;
    readonly maxCharacters: number;
  };
  readonly pk: {
    readonly maxCharacters: number;
  };
  readonly lastWords: {
    readonly firstNightMaxCharacters: number;
    readonly dayExileMaxCharacters: number;
    readonly selfDestructMaxCharacters: number;
  };
  readonly abilityQuote: {
    readonly maxCharacters: number;
  };
}

export interface RulesetDefinition {
  readonly id: string;
  readonly version: string;
  readonly playerCount: number;
  readonly roster: readonly string[];
  readonly sheriff: {
    readonly enabled: boolean;
  };
  readonly identityVisibility: "hidden";
  readonly victoryConditions: readonly VictoryCondition[];
  readonly speechLimits: SpeechLimits;
  readonly selfDestruct: {
    readonly enabled: boolean;
  };
}

export interface RulesetValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}
