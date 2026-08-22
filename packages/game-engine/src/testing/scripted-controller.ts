import type {
  CommandId,
  GameCommand,
  GameEvent,
  SeatId,
} from "@wfill/contracts";
import { SIX_PLAYER_RULESET } from "@wfill/rules-core";
import { applyCommand } from "../engine/apply-command.js";
import { assertGameState } from "../engine/assert-invariants.js";
import { getLegalActions, type LegalAction } from "../engine/legal-actions.js";
import { createGame } from "../setup/create-game.js";
import type { GameState } from "../state/game-state.js";

type WithoutEnvelope<T> = T extends GameCommand
  ? Omit<T, "commandId" | "gameId" | "expectedVersion">
  : never;

export type ScriptedCommand = WithoutEnvelope<GameCommand>;

export interface ScriptedGameInput {
  readonly seed: string;
  readonly commands: readonly ScriptedCommand[];
}

export interface ScriptedGameResult {
  readonly finalState: GameState;
  readonly events: readonly GameEvent[];
  readonly consumedCommandCount: number;
  readonly invariantCheckCount: number;
}

const MAX_COMMANDS = 300;

const targetOf = (command: ScriptedCommand): SeatId | undefined =>
  "targetSeat" in command ? command.targetSeat : undefined;

const matchesSnapshot = (command: ScriptedCommand, legalAction: LegalAction): boolean => {
  if (legalAction.type !== command.type) return false;

  const targetSeat = targetOf(command);
  if (targetSeat !== undefined && !legalAction.targetSeats.includes(targetSeat)) return false;
  if (legalAction.targetRequired && targetSeat === undefined) return false;
  if (
    command.type === "submit_speech"
    && legalAction.speechLimit !== null
    && Array.from(command.content).length > legalAction.speechLimit
  ) return false;
  return true;
};

const expectedVersionFor = (state: GameState, command: ScriptedCommand): number => {
  if (
    (command.type === "submit_vote" || command.type === "pass_action")
    && (state.phase === "day_vote" || state.phase === "day_pk_vote")
    && state.vote !== undefined
    && state.vote !== null
  ) return state.vote.roundVersion;
  return state.version;
};

export const runScriptedGame = ({
  seed,
  commands,
}: ScriptedGameInput): ScriptedGameResult => {
  if (commands.length > MAX_COMMANDS) throw new Error("script_command_limit_exceeded");

  const created = createGame({
    gameId: `scripted-${seed}`,
    ruleset: SIX_PLAYER_RULESET,
    seed,
  });
  let state = created.state;
  const events: GameEvent[] = [...created.events];
  let consumedCommandCount = 0;
  let invariantCheckCount = 0;

  while (state.phase !== "settlement" && consumedCommandCount < commands.length) {
    const command = commands[consumedCommandCount]!;
    const legalActions = getLegalActions(state, command.actorSeat);
    if (!legalActions.some((legalAction) => matchesSnapshot(command, legalAction))) {
      throw new Error(`scripted_action_unavailable:${consumedCommandCount}:${command.type}`);
    }

    const envelopedCommand = {
      ...command,
      commandId: `scripted-${seed}-${consumedCommandCount + 1}` as CommandId,
      gameId: state.gameId,
      expectedVersion: expectedVersionFor(state, command),
    } as GameCommand;
    const previousVersion = state.version;
    const applied = applyCommand(state, envelopedCommand);
    if (applied.events.some((event) => event.type === "action_rejected")) {
      throw new Error(`scripted_command_rejected:${consumedCommandCount}:${command.type}`);
    }

    state = applied.state;
    events.push(...applied.events);
    consumedCommandCount += 1;
    assertGameState(state, previousVersion);
    invariantCheckCount += 1;
  }

  if (state.phase !== "settlement") throw new Error("script_ended_before_game_finished");
  if (consumedCommandCount !== commands.length) throw new Error("script_has_unconsumed_commands");

  return {
    finalState: state,
    events,
    consumedCommandCount,
    invariantCheckCount,
  };
};
