import { describe, expect, it } from "vitest";
import type { GameId, GameView, SeatId } from "@wfill/contracts";
import { ScriptedPlayerController, type PlayerRequest } from "../src/index.js";

const gameId = "controller-game" as GameId;
const seat = 2 as SeatId;
const view: GameView = {
  gameId,
  version: 8,
  day: 1,
  phase: "day_vote",
  outcome: null,
  mode: { kind: "seat", seat },
  seats: [],
  timeline: [],
};

const request = (overrides: Partial<PlayerRequest> = {}): PlayerRequest => ({
  gameId,
  actorSeat: seat,
  expectedVersion: 8,
  taskKind: "day_vote",
  view,
  legalActions: [{ type: "pass_action", targetRequired: false, targetSeats: [], passAllowed: true, speechLimit: null }],
  speechBudget: null,
  ...overrides,
});

describe("脚本玩家控制器", () => {
  it("拒绝冻结合法动作中不存在的选择", async () => {
    const controller = new ScriptedPlayerController([{ type: "submit_vote", targetSeat: 6 as SeatId }]);
    await expect(controller.request(request(), AbortSignal.timeout(100)))
      .rejects.toThrow("scripted_action_not_legal");
  });

  it("拒绝非法目标和超长发言", async () => {
    const vote = new ScriptedPlayerController([{ type: "submit_vote", targetSeat: 6 as SeatId }]);
    await expect(vote.request(request({
      legalActions: [{ type: "submit_vote", targetRequired: true, targetSeats: [3 as SeatId], passAllowed: true, speechLimit: null }],
    }), AbortSignal.timeout(100))).rejects.toThrow("scripted_target_not_legal");

    const speech = new ScriptedPlayerController([{ type: "submit_speech", content: "超过限制" }]);
    await expect(speech.request(request({
      taskKind: "day_speech",
      legalActions: [{ type: "submit_speech", targetRequired: false, targetSeats: [], passAllowed: false, speechLimit: 3 }],
      speechBudget: 3,
    }), AbortSignal.timeout(100))).rejects.toThrow("scripted_speech_too_long");
  });

  it("遵守取消信号且不消费脚本决定", async () => {
    const controller = new ScriptedPlayerController([{ type: "pass_action" }]);
    const abort = new AbortController();
    abort.abort();
    await expect(controller.request(request(), abort.signal)).rejects.toThrow("controller_request_cancelled");
    await expect(controller.request(request(), AbortSignal.timeout(100))).resolves.toEqual({ type: "pass_action" });
  });

  it("请求视图不能包含其他座位私有信息", () => {
    expect(view.mode).toEqual({ kind: "seat", seat: 2 });
    expect(JSON.stringify(view)).not.toMatch(/seat-3-secret|apiKey|auditEvents/);
  });
});
