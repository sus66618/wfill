import { describe, expect, it } from "vitest";
import {
  filterEventsForAudience,
  GameCommandSchema,
  GameEventSchema,
  SeatIdSchema,
} from "../src/index.js";

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

  it("requires an explicit audience for every event", () => {
    expect(GameEventSchema.safeParse({
      eventId: "event-1",
      gameId: "game-1",
      version: 1,
      type: "game_created",
    }).success).toBe(false);
    expect(GameEventSchema.parse({
      eventId: "event-1",
      gameId: "game-1",
      version: 1,
      type: "game_created",
      audience: { kind: "public" },
    }).audience).toEqual({ kind: "public" });
  });

  it("keeps private role assignments out of a public event view", () => {
    const events = [
      GameEventSchema.parse({
        eventId: "event-1",
        gameId: "game-1",
        version: 1,
        type: "game_created",
        audience: { kind: "public" },
      }),
      GameEventSchema.parse({
        eventId: "event-2",
        gameId: "game-1",
        version: 2,
        type: "role_assigned",
        seat: 3,
        role: "seer",
        audience: { kind: "private", seat: 3 },
      }),
    ];

    expect(filterEventsForAudience(events, { kind: "public" }))
      .toEqual([events[0]]);
    expect(filterEventsForAudience(events, { kind: "private", seat: 3 }))
      .toEqual(events);
  });

  it("rejects a public role assignment", () => {
    expect(GameEventSchema.safeParse({
      eventId: "event-2",
      gameId: "game-1",
      version: 2,
      type: "role_assigned",
      seat: 3,
      role: "seer",
      audience: { kind: "public" },
    }).success).toBe(false);
  });

  it("rejects a role assignment addressed to a different seat", () => {
    expect(GameEventSchema.safeParse({
      eventId: "event-2",
      gameId: "game-1",
      version: 2,
      type: "role_assigned",
      seat: 3,
      role: "seer",
      audience: { kind: "private", seat: 4 },
    }).success).toBe(false);
  });
});
