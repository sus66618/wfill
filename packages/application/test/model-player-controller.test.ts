import { describe, expect, it } from "vitest";
import type { GameId, GameView, SeatId } from "@wfill/contracts";
import type { ModelAccount, ModelCallRequest, ModelCallResult } from "@wfill/model-gateway";
import {
  ModelPlayerController,
  parseModelDecision,
  type ModelTextGateway,
  type PlayerRequest,
} from "../src/index.js";

const gameId = "model-controller" as GameId;
const actorSeat = 2 as SeatId;
const account: ModelAccount = {
  accountId: "school-account", displayName: "学校网关", providerKind: "openai-compatible",
  baseUrl: "http://aigw.dlut.edu.cn/v1", credentialRef: "school-key",
};
const view = (phase: GameView["phase"]): GameView => ({
  gameId, version: 9, day: 1, phase, outcome: null,
  mode: { kind: "seat", seat: actorSeat },
  seats: [{ seat: actorSeat, alive: true, isCurrentActor: true, visibleRole: { roleId: "villager", source: "self" } }],
  timeline: [],
});
const speechRequest = (): PlayerRequest => ({
  gameId, actorSeat, expectedVersion: 9, taskKind: "day_speech", view: view("day_speech"),
  legalActions: [{ type: "submit_speech", targetRequired: false, targetSeats: [], passAllowed: false, speechLimit: 20 }],
  speechBudget: 20,
});
const voteRequest = (): PlayerRequest => ({
  gameId, actorSeat, expectedVersion: 9, taskKind: "day_vote", view: view("day_vote"),
  legalActions: [
    { type: "submit_vote", targetRequired: true, targetSeats: [3 as SeatId, 4 as SeatId], passAllowed: true, speechLimit: null },
    { type: "pass_action", targetRequired: false, targetSeats: [], passAllowed: true, speechLimit: null },
  ], speechBudget: null,
});

class FakeGateway implements ModelTextGateway {
  request: ModelCallRequest | null = null;
  constructor(private readonly content: string) {}
  async generate(request: ModelCallRequest): Promise<ModelCallResult> {
    this.request = request;
    return { callId: request.callId, content: this.content, inputTokens: 10, outputTokens: 3, latencyMs: 2, finishReason: "stop" };
  }
}

describe("模型响应决策", () => {
  it("将发言正文转换为公开发言决定", () => {
    expect(parseModelDecision("  我认为3号更可疑。  ", speechRequest()))
      .toEqual({ type: "submit_speech", content: "我认为3号更可疑。" });
  });

  it("将唯一 JSON 对象转换为合法投票或弃票", () => {
    expect(parseModelDecision('{"action":"submit_vote","targetSeat":4}', voteRequest()))
      .toEqual({ type: "submit_vote", targetSeat: 4 });
    expect(parseModelDecision('{"action":"pass_action"}', voteRequest())).toEqual({ type: "pass_action" });
  });

  it.each([
    ["解释如下：{\"action\":\"submit_vote\",\"targetSeat\":4}", "model_action_not_single_json"],
    ["{\"action\":\"submit_vote\",\"targetSeat\":4}\n{\"action\":\"pass_action\"}", "model_action_not_single_json"],
    ["{\"action\":\"force_win\"}", "model_action_schema_invalid"],
    ["{\"action\":\"submit_vote\"}", "model_action_target_required"],
    ["{\"action\":\"submit_vote\",\"targetSeat\":5}", "model_action_target_illegal"],
    ["{\"action\":\"submit_vote\",\"targetSeat\":2}", "model_action_target_illegal"],
    ["{\"action\":\"use_poison\",\"targetSeat\":3}", "model_action_not_legal"],
  ])("拒绝非法结构 %s", (content, message) => {
    expect(() => parseModelDecision(content, voteRequest())).toThrow(message);
  });

  it("拒绝空白和超预算发言", () => {
    expect(() => parseModelDecision("   ", speechRequest())).toThrow("model_speech_empty");
    expect(() => parseModelDecision("这是一段明显超过二十个汉字限制的冗长发言内容。", speechRequest()))
      .toThrow("model_speech_too_long");
  });

  it("控制器组装安全提示词并传递取消信号", async () => {
    const gateway = new FakeGateway('{"action":"submit_vote","targetSeat":3}');
    const controller = new ModelPlayerController({ account, modelId: "Qwen3.5-9B", gateway });
    const abort = new AbortController();
    await expect(controller.request(voteRequest(), abort.signal))
      .resolves.toEqual({ type: "submit_vote", targetSeat: 3 });
    expect(gateway.request).toMatchObject({ modelId: "Qwen3.5-9B", maxOutputTokens: 128 });
    expect(JSON.stringify(gateway.request)).not.toContain("school-secret");
  });
});
