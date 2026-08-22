import { z } from "zod";
import { CommandIdSchema, GameIdSchema, SeatIdSchema } from "./ids.js";

const CommandEnvelopeSchema = z.object({
  commandId: CommandIdSchema,
  gameId: GameIdSchema,
  expectedVersion: z.number().int().min(0),
  actorSeat: SeatIdSchema,
});

export const GameCommandSchema = z.discriminatedUnion("type", [
  CommandEnvelopeSchema.extend({ type: z.literal("submit_speech"), content: z.string().min(1) }),
  CommandEnvelopeSchema.extend({ type: z.literal("submit_vote"), targetSeat: SeatIdSchema }),
  CommandEnvelopeSchema.extend({ type: z.literal("submit_wolf_kill"), targetSeat: SeatIdSchema }),
  CommandEnvelopeSchema.extend({ type: z.literal("inspect_player"), targetSeat: SeatIdSchema }),
  CommandEnvelopeSchema.extend({ type: z.literal("use_antidote") }),
  CommandEnvelopeSchema.extend({ type: z.literal("use_poison"), targetSeat: SeatIdSchema }),
  CommandEnvelopeSchema.extend({ type: z.literal("self_destruct") }),
  CommandEnvelopeSchema.extend({ type: z.literal("pass_action") }),
]);

export type GameCommand = z.infer<typeof GameCommandSchema>;
