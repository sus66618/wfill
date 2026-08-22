import type { RoleDefinition } from "../types.js";

const role = (definition: RoleDefinition): RoleDefinition =>
  Object.freeze({
    ...definition,
    abilityIds: Object.freeze([...definition.abilityIds]),
  });

export const BASE_ROLES = Object.freeze({
  villager: role({
    id: "villager",
    version: "1.0.0",
    faction: "good",
    roleType: "civilian",
    abilityIds: [],
    aiDescription: "无夜间技能的好人，需要通过公开发言和投票寻找狼人。",
  }),
  werewolf: role({
    id: "werewolf",
    version: "1.0.0",
    faction: "werewolf",
    roleType: "werewolf",
    abilityIds: ["wolf_kill", "self_destruct"],
    aiDescription: "夜间与其他狼人协作，白天隐藏身份并淘汰所有好人。",
  }),
  seer: role({
    id: "seer",
    version: "1.0.0",
    faction: "good",
    roleType: "seer",
    abilityIds: ["inspect_player"],
    aiDescription: "每夜可查验一名其他存活玩家的阵营。",
  }),
  witch: role({
    id: "witch",
    version: "1.0.0",
    faction: "good",
    roleType: "witch",
    abilityIds: ["use_antidote", "use_poison"],
    aiDescription: "持有一次解药和一次毒药，遵守不能自救及同夜双药的规则。",
  }),
  hunter: role({
    id: "hunter",
    version: "1.0.0",
    faction: "good",
    roleType: "hunter",
    abilityIds: ["hunter_shot"],
    aiDescription: "出局时可能发动带走目标的技能，具体触发由版型决定。",
  }),
  "wolf-king": role({
    id: "wolf-king",
    version: "1.0.0",
    faction: "werewolf",
    roleType: "wolf_king",
    abilityIds: ["wolf_kill", "wolf_king_shot"],
    aiDescription: "具有死亡触发技能的狼人，是否启用由版型决定。",
  }),
  "white-wolf-king": role({
    id: "white-wolf-king",
    version: "1.0.0",
    faction: "werewolf",
    roleType: "white_wolf_king",
    abilityIds: ["wolf_kill", "white_wolf_king_explode"],
    aiDescription: "可在指定时机以自身出局换取效果的狼人，是否启用由版型决定。",
  }),
  idiot: role({
    id: "idiot",
    version: "1.0.0",
    faction: "good",
    roleType: "idiot",
    abilityIds: ["survive_exile_once"],
    aiDescription: "拥有一次放逐生还能力的好人，具体限制由版型决定。",
  }),
  guard: role({
    id: "guard",
    version: "1.0.0",
    faction: "good",
    roleType: "guard",
    abilityIds: ["guard_player"],
    aiDescription: "夜间可保护目标的好人，具体限制由版型决定。",
  }),
} satisfies Readonly<Record<string, RoleDefinition>>);
