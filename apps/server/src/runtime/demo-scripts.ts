import type { SeatId } from "@wfill/contracts";
import type { PlayerDecision, ScriptedPlayerController } from "@wfill/application";
import { ScriptedPlayerController as Controller, StaticControllerRegistry } from "@wfill/application";

export type DemoSeed = "good-win" | "wolf-win";

type SeatDecision = PlayerDecision & { readonly actorSeat: SeatId };

const seat = (value: number): SeatId => value as SeatId;

const scripts: Record<DemoSeed, readonly SeatDecision[]> = {
  "good-win": [
    { type: "submit_wolf_kill", actorSeat: seat(2), targetSeat: seat(3) },
    { type: "submit_wolf_kill", actorSeat: seat(4), targetSeat: seat(3) },
    { type: "inspect_player", actorSeat: seat(1), targetSeat: seat(2) },
    { type: "use_poison", actorSeat: seat(5), targetSeat: seat(2) },
    { type: "submit_speech", actorSeat: seat(2), content: "二号首夜遗言。" },
    { type: "submit_speech", actorSeat: seat(3), content: "三号首夜遗言。" },
    { type: "submit_speech", actorSeat: seat(4), content: "四号发言。" },
    { type: "submit_speech", actorSeat: seat(5), content: "五号发言。" },
    { type: "submit_speech", actorSeat: seat(6), content: "六号发言。" },
    { type: "submit_speech", actorSeat: seat(1), content: "一号发言。" },
    { type: "submit_vote", actorSeat: seat(1), targetSeat: seat(4) },
    { type: "pass_action", actorSeat: seat(4) },
    { type: "submit_vote", actorSeat: seat(5), targetSeat: seat(4) },
    { type: "submit_vote", actorSeat: seat(6), targetSeat: seat(4) },
    { type: "submit_speech", actorSeat: seat(4), content: "四号放逐遗言。" },
  ],
  "wolf-win": [
    { type: "submit_wolf_kill", actorSeat: seat(1), targetSeat: seat(4) },
    { type: "submit_wolf_kill", actorSeat: seat(6), targetSeat: seat(4) },
    { type: "pass_action", actorSeat: seat(3) },
    { type: "use_poison", actorSeat: seat(2), targetSeat: seat(5) },
    { type: "submit_speech", actorSeat: seat(4), content: "四号首夜遗言。" },
    { type: "submit_speech", actorSeat: seat(5), content: "五号首夜遗言。" },
    { type: "submit_speech", actorSeat: seat(3), content: "三号发言。" },
    { type: "submit_speech", actorSeat: seat(2), content: "二号发言。" },
    { type: "submit_speech", actorSeat: seat(1), content: "一号发言。" },
    { type: "submit_speech", actorSeat: seat(6), content: "六号发言。" },
    { type: "submit_vote", actorSeat: seat(1), targetSeat: seat(3) },
    { type: "submit_vote", actorSeat: seat(2), targetSeat: seat(3) },
    { type: "pass_action", actorSeat: seat(3) },
    { type: "submit_vote", actorSeat: seat(6), targetSeat: seat(3) },
    { type: "submit_speech", actorSeat: seat(3), content: "三号放逐遗言。" },
    { type: "submit_wolf_kill", actorSeat: seat(1), targetSeat: seat(2) },
    { type: "submit_wolf_kill", actorSeat: seat(6), targetSeat: seat(2) },
    { type: "pass_action", actorSeat: seat(2) },
  ],
};

export const createDemoControllers = (seed: DemoSeed, consumedCommands = 0): StaticControllerRegistry => {
  const controllers = new Map<SeatId, ScriptedPlayerController>();
  const remaining = scripts[seed].slice(consumedCommands);
  for (let value = 1; value <= 6; value += 1) {
    const actorSeat = seat(value);
    controllers.set(actorSeat, new Controller(remaining
      .filter((decision) => decision.actorSeat === actorSeat)
      .map(({ actorSeat: _actorSeat, ...decision }) => decision)));
  }
  return new StaticControllerRegistry(controllers);
};
