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

  it.each([
    {
      name: "action rejection",
      payload: {
        type: "action_rejected",
        commandId: "command-1",
        reason: "illegal_target",
        actorSeat: 3,
      },
    },
    {
      name: "night action record",
      payload: {
        type: "night_action_recorded",
        actorSeat: 3,
        action: "inspect_player",
      },
    },
    {
      name: "inspection result",
      payload: {
        type: "inspection_result",
        actorSeat: 3,
        targetSeat: 1,
        faction: "werewolf",
      },
    },
  ])("forces $name to the actor's private audience", ({ payload }) => {
    const envelope = {
      eventId: "event-private",
      gameId: "game-1",
      version: 8,
      ...payload,
    };

    expect(GameEventSchema.safeParse({
      ...envelope,
      audience: { kind: "public" },
    }).success).toBe(false);
    expect(GameEventSchema.safeParse({
      ...envelope,
      audience: { kind: "private", seat: 4 },
    }).success).toBe(false);
    expect(GameEventSchema.parse({
      ...envelope,
      audience: { kind: "private", seat: 3 },
    })).toMatchObject({
      ...payload,
      audience: { kind: "private", seat: 3 },
    });
  });

  it("forces a wolf decision to its declared recipient", () => {
    const envelope = {
      eventId: "event-wolf",
      gameId: "game-1",
      version: 9,
      type: "wolf_decision",
      targetSeat: 5,
      recipientSeat: 2,
    };

    expect(GameEventSchema.safeParse({
      ...envelope,
      audience: { kind: "public" },
    }).success).toBe(false);
    expect(GameEventSchema.safeParse({
      ...envelope,
      audience: { kind: "private", seat: 1 },
    }).success).toBe(false);
    expect(GameEventSchema.parse({
      ...envelope,
      audience: { kind: "private", seat: 2 },
    })).toMatchObject({
      recipientSeat: 2,
      audience: { kind: "private", seat: 2 },
    });
  });

  it("forces night resolution to the public audience", () => {
    const envelope = {
      eventId: "event-night",
      gameId: "game-1",
      version: 10,
      type: "night_resolved",
      eliminatedSeats: [3],
    };

    expect(GameEventSchema.safeParse({
      ...envelope,
      audience: { kind: "private", seat: 3 },
    }).success).toBe(false);
    expect(GameEventSchema.parse({
      ...envelope,
      audience: { kind: "public" },
    }).audience).toEqual({ kind: "public" });
  });
});
