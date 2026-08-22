import type { EventId, GameEvent, GameId, SeatId } from "@wfill/contracts";
import type { RulesetDefinition } from "@wfill/rules-core";
import type { GameState, PlayerState } from "../state/game-state.js";
import { assertGameState } from "../engine/assert-invariants.js";
import { createSeededRandom } from "./seeded-random.js";

export interface CreateGameInput {
  readonly gameId: string;
  readonly ruleset: RulesetDefinition;
  readonly seed: string;
}

export interface CreateGameResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

const shuffle = (roster: readonly string[], seed: string): string[] => {
  const shuffled = [...roster];
  const random = createSeededRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
};

const eventIdFor = (gameId: GameId, version: number): EventId =>
  `${gameId}:${version}` as EventId;

export const createGame = ({ gameId, ruleset, seed }: CreateGameInput): CreateGameResult => {
  const typedGameId = gameId as GameId;
  const rolesBySeat = shuffle(ruleset.roster, seed);
  const assignedPlayers = rolesBySeat.map((roleId, index) => ({
    seat: (index + 1) as SeatId,
    roleId,
  }));
  const wolfSeats = assignedPlayers
    .filter((player) => player.roleId === "werewolf")
    .map((player) => player.seat);
  const players: readonly PlayerState[] = assignedPlayers.map((player) => ({
    ...player,
    alive: true,
    privateState: {
      wolfTeammateSeats: player.roleId === "werewolf"
        ? wolfSeats.filter((seat) => seat !== player.seat)
        : [],
      ...(player.roleId === "witch"
        ? { witchResources: { antidoteAvailable: true, poisonAvailable: true } }
        : {}),
    },
  }));
  const events: GameEvent[] = [{
    eventId: eventIdFor(typedGameId, 1),
    gameId: typedGameId,
    version: 1,
    type: "game_created",
    audience: { kind: "public" },
  }];

  for (const player of players) {
    const version = events.length + 1;
    events.push({
      eventId: eventIdFor(typedGameId, version),
      gameId: typedGameId,
      version,
      type: "role_assigned",
      seat: player.seat,
      role: player.roleId,
      audience: { kind: "private", seat: player.seat },
    });
  }

  const result: CreateGameResult = {
    state: {
      gameId: typedGameId,
      rulesetId: ruleset.id,
      rulesetVersion: ruleset.version,
      seed,
      speechLimits: ruleset.speechLimits,
      selfDestructEnabled: ruleset.selfDestruct.enabled,
      dayNumber: 0,
      lastNightEliminatedSeats: [],
      version: events.length,
      phase: "night_wolf_discussion",
      outcome: "ongoing",
      players,
      pendingEffects: [],
      processedCommandIds: [],
      night: {
        wolfConfirmationRound: 1,
        wolfSubmissions: [],
        submittedActorSeats: [],
        potionUsed: false,
      },
      speech: null,
      vote: null,
      publicVoteResult: null,
      pendingExileSeat: null,
    },
    events,
  };
  assertGameState(result.state);
  return result;
};
