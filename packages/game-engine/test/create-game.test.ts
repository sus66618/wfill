import { describe, expect, it } from "vitest";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import { createGame } from "../src/index.js";

describe("createGame", () => {
  it("assigns the same roles for the same seed", () => {
    const first = createGame({ gameId: "game-1", ruleset: SIX_PLAYER_RULESET, seed: "seed-a" });
    const second = createGame({ gameId: "game-2", ruleset: SIX_PLAYER_RULESET, seed: "seed-a" });

    expect(first.state.players.map((player) => player.roleId))
      .toEqual(second.state.players.map((player) => player.roleId));
  });

  it("starts at the first-night wolf discussion window", () => {
    const result = createGame({ gameId: "game-1", ruleset: SIX_PLAYER_RULESET, seed: "seed-a" });

    expect(result.state.phase).toBe("night_wolf_discussion");
    expect(result.state.version).toBe(result.events.length);
  });

  it("creates ordered seats, private wolf knowledge, and ready witch resources", () => {
    const result = createGame({ gameId: "game-1", ruleset: SIX_PLAYER_RULESET, seed: "seed-a" });
    const wolves = result.state.players.filter((player) => player.roleId === "werewolf");
    const witch = result.state.players.find((player) => player.roleId === "witch");

    expect(result.state.players.map((player) => player.seat)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(wolves).toHaveLength(2);
    expect(wolves.map((wolf) => wolf.privateState.wolfTeammateSeats))
      .toEqual([[wolves[1]?.seat], [wolves[0]?.seat]]);
    expect(witch?.privateState.witchResources).toEqual({
      antidoteAvailable: true,
      poisonAvailable: true,
    });
  });

  it("records game creation followed by one role assignment per seat", () => {
    const result = createGame({ gameId: "game-1", ruleset: SIX_PLAYER_RULESET, seed: "seed-a" });

    expect(result.events).toHaveLength(7);
    expect(result.events[0]).toMatchObject({
      type: "game_created",
      gameId: "game-1",
      version: 1,
      audience: { kind: "public" },
    });
    expect(result.events.slice(1)).toEqual(
      result.state.players.map((player, index) => ({
        eventId: `game-1:${index + 2}`,
        gameId: "game-1",
        version: index + 2,
        type: "role_assigned",
        seat: player.seat,
        role: player.roleId,
        audience: { kind: "private", seat: player.seat },
      })),
    );
  });

  it("makes every role assignment visible only to its assigned seat", () => {
    const result = createGame({ gameId: "game-1", ruleset: SIX_PLAYER_RULESET, seed: "seed-a" });
    const assignments = result.events.filter((event) => event.type === "role_assigned");

    expect(assignments.map((event) => event.audience)).toEqual(
      result.state.players.map((player) => ({ kind: "private", seat: player.seat })),
    );
  });
});
