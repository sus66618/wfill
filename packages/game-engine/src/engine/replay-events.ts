import type { GameEvent } from "@wfill/contracts";
import { assertGameState } from "./assert-invariants.js";
import type { GameState } from "../state/game-state.js";

/** 从裁判专用检查点恢复确定性状态；公开投影永远拿不到该事件。 */
export const replayEvents = (
  initialState: GameState,
  events: readonly GameEvent[],
): GameState => {
  let state = initialState;
  for (const event of events) {
    if (event.type === "state_checkpoint") state = event.state as unknown as GameState;
    if (event.type === "action_rejected" && !state.processedCommandIds.includes(event.commandId)) {
      state = {
        ...state,
        version: event.version,
        processedCommandIds: [...state.processedCommandIds, event.commandId],
      };
    }
  }
  assertGameState(state);
  return state;
};
