import type { SeatId } from "@wfill/contracts";
import type { ScriptedGameInput } from "../../src/index.js";

const seat = (value: number): SeatId => value as SeatId;

export const GOOD_WIN_SCRIPT: ScriptedGameInput = {
  seed: "good-win",
  commands: [
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
};
