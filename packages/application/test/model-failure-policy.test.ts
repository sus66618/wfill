import { describe, expect, it } from "vitest";
import type { GameId, GameView, SeatId } from "@wfill/contracts";
import { ModelGatewayError } from "@wfill/model-gateway";
import {
  ModelTurnRequiredError,
  executeWithModelPolicy,
  type ModelAttemptKind,
  type PlayerRequest,
} from "../src/index.js";

const gameId = "policy-game" as GameId;
const seat = 2 as SeatId;
const request = (kind: "speech" | "vote" | "mandatory"): PlayerRequest => {
  const phase = kind === "speech" ? "day_speech" : kind === "vote" ? "day_vote" : "night_wolf_final_confirmation";
  const view: GameView = {
    gameId, version: 5, day: 1, phase, outcome: null, mode: { kind: "seat", seat }, seats: [], timeline: [],
  };
  return {
    gameId, actorSeat: seat, expectedVersion: 5, taskKind: phase, view,
    legalActions: kind === "speech"
      ? [{ type: "submit_speech", targetRequired: false, targetSeats: [], passAllowed: false, speechLimit: 10 }]
      : kind === "vote"
        ? [
            { type: "submit_vote", targetRequired: true, targetSeats: [3 as SeatId], passAllowed: true, speechLimit: null },
            { type: "pass_action", targetRequired: false, targetSeats: [], passAllowed: true, speechLimit: null },
          ]
        : [{ type: "submit_wolf_kill", targetRequired: true, targetSeats: [3 as SeatId], passAllowed: false, speechLimit: null }],
    speechBudget: kind === "speech" ? 10 : null,
  };
};

describe("模型回合失败策略", () => {
  it("临时错误最多重试两次并使用有界指数退避", async () => {
    const calls: ModelAttemptKind[] = [];
    const delays: number[] = [];
    const outcome = await executeWithModelPolicy({
      request: request("vote"),
      call: async (kind) => {
        calls.push(kind);
        if (calls.length < 3) throw new ModelGatewayError("rate_limit", true, 429);
        return '{"action":"submit_vote","targetSeat":3}';
      },
      delay: async (milliseconds) => { delays.push(milliseconds); },
    });
    expect(outcome.decision).toEqual({ type: "submit_vote", targetSeat: 3 });
    expect(calls).toEqual(["initial", "initial", "initial"]);
    expect(delays).toEqual([100, 200]);
    expect(outcome.attempts).toBe(3);
  });

  it("动作格式错误只发起一次格式修复", async () => {
    const calls: ModelAttemptKind[] = [];
    const outcome = await executeWithModelPolicy({
      request: request("vote"), delay: async () => {},
      call: async (kind) => {
        calls.push(kind);
        return kind === "initial" ? "我投3号" : '{"action":"submit_vote","targetSeat":3}';
      },
    });
    expect(calls).toEqual(["initial", "format_repair"]);
    expect(outcome.decision).toEqual({ type: "submit_vote", targetSeat: 3 });
  });

  it("长发言压缩一次，仍超限则在完整句子边界截断", async () => {
    const calls: ModelAttemptKind[] = [];
    const outcome = await executeWithModelPolicy({
      request: request("speech"), delay: async () => {},
      call: async (kind) => {
        calls.push(kind);
        return kind === "initial" ? "三号很可疑。四号也需要关注。" : "三号确实非常可疑。四号也同样值得重点关注。";
      },
    });
    expect(calls).toEqual(["initial", "speech_compression"]);
    expect(outcome.decision).toEqual({ type: "submit_speech", content: "三号确实非常可疑。" });
    expect(outcome.degraded).toBe(true);
  });

  it("最终失败按发言、投票和强制动作分别处理", async () => {
    const fail = async () => { throw new ModelGatewayError("auth", false, 401); };
    await expect(executeWithModelPolicy({ request: request("speech"), call: fail, delay: async () => {} }))
      .resolves.toMatchObject({ decision: { type: "submit_speech", content: "过。" }, degraded: true });
    await expect(executeWithModelPolicy({ request: request("vote"), call: fail, delay: async () => {} }))
      .resolves.toMatchObject({ decision: { type: "pass_action" }, degraded: true });
    await expect(executeWithModelPolicy({ request: request("mandatory"), call: fail, delay: async () => {} }))
      .rejects.toBeInstanceOf(ModelTurnRequiredError);
  });

  it("鉴权、模型不存在、额度和取消不重试", async () => {
    for (const code of ["auth", "model_not_found", "quota", "cancelled"] as const) {
      let calls = 0;
      await executeWithModelPolicy({
        request: request("vote"), delay: async () => {},
        call: async () => { calls += 1; throw new ModelGatewayError(code, false); },
      });
      expect(calls).toBe(1);
    }
  });
});
