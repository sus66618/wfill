import { describe, expect, it } from "vitest";
import { createGame } from "@wfill/game-engine";

describe("package export", () => {
  it("imports the engine through its package name", () => {
    expect(typeof createGame).toBe("function");
  });
});
