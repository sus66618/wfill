import { describe, expect, it } from "vitest";
import { GameCommandSchema, SeatIdSchema } from "../src/index.js";

describe("runtime contracts", () => {
  it("rejects seat zero", () => {
    expect(() => SeatIdSchema.parse(0)).toThrow();
  });

  it("parses a structured vote command", () => {
    const command = GameCommandSchema.parse({
      commandId: "cmd-1",
      gameId: "game-1",
      expectedVersion: 4,
      actorSeat: 2,
      type: "submit_vote",
      targetSeat: 3,
    });
    expect(command.type).toBe("submit_vote");
  });
});
