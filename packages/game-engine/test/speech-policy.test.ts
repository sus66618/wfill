import { describe, expect, it } from "vitest";
import { createSpeakingOrder, deriveSpeechDirection, validateSpeech } from "../src/index.js";

describe("speech policy", () => {
  it("rejects ordinary speech above 220 Chinese characters", () => {
    expect(validateSpeech("狼".repeat(221), 220)).toEqual({
      ok: false,
      reason: "speech_too_long",
      actualLength: 221,
      limit: 220,
    });
  });

  it("counts Unicode code points and accepts the exact limit", () => {
    expect(validateSpeech("🐺好", 2)).toEqual({
      ok: true,
      actualLength: 2,
      limit: 2,
    });
  });

  it("starts beside the latest death and follows the frozen direction", () => {
    expect(createSpeakingOrder({
      seed: "round-a",
      aliveSeats: [1, 2, 4, 5, 6],
      priorDeathSeats: [3],
      direction: "clockwise",
    })).toEqual([4, 5, 6, 1, 2]);

    expect(createSpeakingOrder({
      seed: "round-a",
      aliveSeats: [1, 2, 4, 5, 6],
      priorDeathSeats: [3],
      direction: "counterclockwise",
    })).toEqual([2, 1, 6, 5, 4]);
  });

  it("uses the seed deterministically when nobody died", () => {
    const input = {
      seed: "opening-seed",
      aliveSeats: [1, 2, 3, 4, 5, 6],
      priorDeathSeats: [],
      direction: "clockwise" as const,
    };

    expect(createSpeakingOrder(input)).toEqual(createSpeakingOrder(input));
    expect(createSpeakingOrder(input)).toHaveLength(6);
  });

  it("derives both directions reproducibly from seed and day context", () => {
    const directions = new Set(Array.from({ length: 32 }, (_, index) =>
      deriveSpeechDirection(`seed-${index}`, 2, "ordinary")));

    expect(directions).toEqual(new Set(["clockwise", "counterclockwise"]));
    expect(deriveSpeechDirection("fixed-seed", 3)).toBe(deriveSpeechDirection("fixed-seed", 3));
  });
});
