import { describe, expect, it } from "vitest";
import { gameViewSchema, sessionControlSchema } from "../src/application.js";

describe("应用层协议", () => {
  it("拒绝浏览器视图中的未声明隐藏字段", () => {
    const parsed = gameViewSchema.safeParse({
      gameId: "g-1",
      version: 8,
      day: 1,
      phase: "day_speech",
      outcome: null,
      mode: { kind: "public" },
      seats: [],
      timeline: [],
      cause: "poison",
    });

    expect(parsed.success).toBe(false);
  });

  it("只接受明确的会话控制命令", () => {
    expect(sessionControlSchema.parse({ type: "step" })).toEqual({ type: "step" });
    expect(sessionControlSchema.safeParse({ type: "force_win" }).success).toBe(false);
  });
});
