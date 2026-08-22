import { describe, expect, it } from "vitest";
import type { CommandId, GameCommand, GameId, SeatId } from "@wfill/contracts";
import { applyCommand, getLegalActions } from "../src/index.js";
import type { GamePhase, GameState, PlayerState } from "../src/index.js";

const seat = (value: number): SeatId => value as SeatId;

const player = (seatNumber: number, roleId: string, alive = true): PlayerState => ({
  seat: seat(seatNumber),
  roleId,
  alive,
  privateState: {
    wolfTeammateSeats: roleId === "werewolf"
      ? [seat(seatNumber === 1 ? 2 : 1)]
      : [],
    ...(roleId === "witch"
      ? { witchResources: { antidoteAvailable: true, poisonAvailable: true } }
      : {}),
  },
});

const makeState = (
  phase: GamePhase = "night_seer_action",
  players: readonly PlayerState[] = [
    player(1, "werewolf"),
    player(2, "werewolf"),
    player(3, "villager"),
    player(4, "witch"),
    player(5, "seer"),
    player(6, "villager"),
  ],
): GameState => ({
  gameId: "game-1" as GameId,
  rulesetId: "six-player-classic-no-sheriff",
  rulesetVersion: "1.0.0",
  version: 10,
  phase,
  players,
  pendingEffects: [],
  processedCommandIds: [],
  night: {
    wolfConfirmationRound: 1,
    wolfSubmissions: [],
    submittedActorSeats: [],
    potionUsed: false,
  },
});

const command = (
  value: Omit<GameCommand, "commandId" | "gameId" | "expectedVersion">,
  commandId = "command-1",
): GameCommand => ({
  ...value,
  commandId: commandId as CommandId,
  gameId: "game-1" as GameId,
  expectedVersion: 10,
} as GameCommand);

describe("command validation", () => {
  it("rejects a villager attempting to inspect", () => {
    const result = applyCommand(
      makeState(),
      command({ type: "inspect_player", actorSeat: seat(3), targetSeat: seat(4) }),
    );

    expect(result.events).toHaveLength(1);
    expect(result.events.at(-1)).toMatchObject({
      type: "action_rejected",
      reason: "role_ability_forbidden",
    });
    expect(result.state.pendingEffects).toEqual([]);
    expect(result.state.version).toBe(11);
  });

  it("prevents the witch from self-saving", () => {
    const state = {
      ...makeState("night_witch_action"),
      pendingEffects: [{ type: "wolf_kill", targetSeat: seat(4) }] as const,
      night: {
        ...makeState().night,
        wolfTargetSeat: seat(4),
      },
    };

    const result = applyCommand(
      state,
      command({ type: "use_antidote", actorSeat: seat(4) }),
    );

    expect(result.events.at(-1)).toMatchObject({
      type: "action_rejected",
      reason: "witch_self_save_forbidden",
    });
    expect(result.state.pendingEffects).toEqual(state.pendingEffects);
  });

  it.each([
    {
      name: "a stale expected version",
      state: makeState(),
      input: { ...command({ type: "inspect_player", actorSeat: seat(5), targetSeat: seat(3) }), expectedVersion: 9 },
      reason: "version_conflict",
    },
    {
      name: "a dead actor",
      state: makeState("night_seer_action", [
        player(1, "werewolf"), player(2, "werewolf"), player(3, "villager"),
        player(4, "witch"), player(5, "seer", false), player(6, "villager"),
      ]),
      input: command({ type: "inspect_player", actorSeat: seat(5), targetSeat: seat(3) }),
      reason: "actor_not_alive",
    },
    {
      name: "an action outside its window",
      state: makeState("night_wolf_discussion"),
      input: command({ type: "inspect_player", actorSeat: seat(5), targetSeat: seat(3) }),
      reason: "action_window_closed",
    },
    {
      name: "an illegal target",
      state: makeState(),
      input: command({ type: "inspect_player", actorSeat: seat(5), targetSeat: seat(5) }),
      reason: "illegal_target",
    },
  ])("rejects $name without applying a pending effect", ({ state, input, reason }) => {
    const result = applyCommand(state, input);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ type: "action_rejected", reason });
    expect(result.state.pendingEffects).toEqual(state.pendingEffects);
  });

  it("returns the exact current state and no events when replaying a processed command", () => {
    const input = command({ type: "inspect_player", actorSeat: seat(5), targetSeat: seat(3) });
    const first = applyCommand(makeState(), input);
    const replay = applyCommand(first.state, input);

    expect(replay.state).toBe(first.state);
    expect(replay.state).toEqual(first.state);
    expect(replay.state.version).toBe(first.state.version);
    expect(replay.state.processedCommandIds).toEqual(first.state.processedCommandIds);
    expect(replay.events).toEqual([]);
  });

  it("offers only role- and window-appropriate legal actions", () => {
    const state = makeState();

    expect(getLegalActions(state, seat(3))).toEqual([]);
    expect(getLegalActions(state, seat(5))).toEqual([
      { type: "inspect_player", targetSeats: [seat(1), seat(2), seat(3), seat(4), seat(6)] },
      { type: "pass_action" },
    ]);
  });

  it("rejects an unavailable potion", () => {
    const players = makeState().players.map((entry) => entry.roleId === "witch"
      ? {
          ...entry,
          privateState: {
            ...entry.privateState,
            witchResources: { antidoteAvailable: false, poisonAvailable: true },
          },
        }
      : entry);
    const state = {
      ...makeState("night_witch_action", players),
      pendingEffects: [{ type: "wolf_kill", targetSeat: seat(3) }] as const,
      night: { ...makeState().night, wolfTargetSeat: seat(3) },
    };

    const result = applyCommand(
      state,
      command({ type: "use_antidote", actorSeat: seat(4) }),
    );

    expect(result.events[0]).toMatchObject({
      type: "action_rejected",
      reason: "resource_unavailable",
    });
  });
});
