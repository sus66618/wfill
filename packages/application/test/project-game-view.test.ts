import { describe, expect, it } from "vitest";
import type { GameEvent, GameId, SeatId, SpectatorMode } from "@wfill/contracts";
import type { GameState } from "@wfill/game-engine";
import { projectGameView } from "../src/project-game-view.js";

const seat = (value: number): SeatId => value as SeatId;
const gameId = "projection-game" as GameId;

const state: GameState = {
  gameId,
  rulesetId: "six-player-classic-no-sheriff",
  rulesetVersion: "1.0.0",
  seed: "projection-seed",
  dayNumber: 1,
  version: 12,
  phase: "day_speech",
  outcome: "ongoing",
  players: [
    { seat: seat(1), roleId: "villager", alive: true, privateState: { wolfTeammateSeats: [] } },
    { seat: seat(2), roleId: "witch", alive: true, privateState: { wolfTeammateSeats: [], witchResources: { antidoteAvailable: false, poisonAvailable: true } } },
    { seat: seat(3), roleId: "werewolf", alive: true, privateState: { wolfTeammateSeats: [seat(4)] } },
    { seat: seat(4), roleId: "werewolf", alive: true, privateState: { wolfTeammateSeats: [seat(3)] } },
    { seat: seat(5), roleId: "seer", alive: false, privateState: { wolfTeammateSeats: [] } },
    { seat: seat(6), roleId: "villager", alive: true, privateState: { wolfTeammateSeats: [] } },
  ],
  pendingEffects: [],
  processedCommandIds: [],
  night: { wolfConfirmationRound: 1, wolfSubmissions: [], submittedActorSeats: [], potionUsed: false },
  speech: { kind: "ordinary", eligibleSpeakerSeats: [seat(1), seat(2)], speakingOrder: [seat(1), seat(2)], submittedSpeakerSeats: [], limit: 220 },
  vote: null,
  publicVoteResult: null,
  pendingExileSeat: null,
};

const playerEvents: GameEvent[] = [
  { eventId: "speech-1", gameId, version: 10, type: "speech_published", seat: seat(6), content: "我认为 3 号值得关注。", audience: { kind: "public" }, dayNumber: 1, phase: "day_speech" },
  { eventId: "death-1", gameId, version: 11, type: "player_eliminated", seat: seat(5), audience: { kind: "public" }, dayNumber: 1, phase: "dawn" },
  { eventId: "inspect-1", gameId, version: 9, type: "inspection_result", actorSeat: seat(5), targetSeat: seat(3), faction: "werewolf", audience: { kind: "private", seat: seat(5) }, dayNumber: 0, phase: "night_seer_action" },
];

const auditEvents: GameEvent[] = [
  { eventId: "cause-1", gameId, version: 11, type: "elimination_cause_recorded", seat: seat(5), cause: "poison", audience: { kind: "god" }, dayNumber: 1, phase: "dawn" },
  { eventId: "checkpoint-1", gameId, version: 12, type: "command_committed", commandId: "secret-command", state: { apiKey: "api-key", rawResponse: "hidden" }, audience: { kind: "god" }, dayNumber: 1, phase: "day_speech" },
];

const project = (mode: SpectatorMode) => projectGameView({ state, playerEvents, auditEvents, mode });

describe("观战安全投影", () => {
  it("公开视角只暴露公开事实", () => {
    const view = project({ kind: "public" });
    expect(view.seats.every((item) => item.visibleRole === undefined)).toBe(true);
    expect(view.timeline).toContainEqual(expect.objectContaining({ kind: "elimination", seat: 5 }));
    expect(JSON.stringify(view)).not.toMatch(/poison|inspection|api-key|rawResponse|werewolf/);
  });

  it("跟随座位只看到自己的身份和依法可见的私有结果", () => {
    const villager = project({ kind: "seat", seat: seat(1) });
    expect(villager.seats.find((item) => item.seat === 1)?.visibleRole?.roleId).toBe("villager");
    expect(JSON.stringify(villager)).not.toMatch(/poison|api-key|rawResponse/);

    const seer = project({ kind: "seat", seat: seat(5) });
    expect(seer.timeline).toContainEqual(expect.objectContaining({ kind: "inspection", targetSeat: 3, faction: "werewolf" }));
  });

  it("狼人跟随视角能看到队友但看不到其他身份", () => {
    const wolf = project({ kind: "seat", seat: seat(3) });
    expect(wolf.seats.find((item) => item.seat === 3)?.visibleRole).toEqual({ roleId: "werewolf", source: "self" });
    expect(wolf.seats.find((item) => item.seat === 4)?.visibleRole).toEqual({ roleId: "werewolf", source: "wolf_team" });
    expect(wolf.seats.find((item) => item.seat === 2)?.visibleRole).toBeUndefined();
  });

  it("上帝视角看到身份和死因但永不暴露审计检查点", () => {
    const god = project({ kind: "god" });
    expect(god.seats.every((item) => item.visibleRole?.source === "god")).toBe(true);
    expect(god.timeline).toContainEqual(expect.objectContaining({ kind: "death_detail", seat: 5, cause: "poison" }));
    expect(JSON.stringify(god)).not.toMatch(/api-key|rawResponse|secret-command|checkpoint/);
  });
});
