import { z } from "zod";
import { CommandIdSchema, EventIdSchema, GameIdSchema, SeatIdSchema } from "./ids.js";

const EventEnvelopeSchema = z.object({
  eventId: EventIdSchema,
  gameId: GameIdSchema,
  version: z.number().int().min(0),
});

export const GameEventSchema = z.discriminatedUnion("type", [
  EventEnvelopeSchema.extend({ type: z.literal("game_created") }),
  EventEnvelopeSchema.extend({ type: z.literal("role_assigned"), seat: SeatIdSchema, role: z.string().min(1) }),
  EventEnvelopeSchema.extend({ type: z.literal("phase_advanced"), phase: z.string().min(1) }),
  EventEnvelopeSchema.extend({ type: z.literal("speech_published"), seat: SeatIdSchema, content: z.string().min(1) }),
  EventEnvelopeSchema.extend({ type: z.literal("vote_accepted"), actorSeat: SeatIdSchema, targetSeat: SeatIdSchema }),
  EventEnvelopeSchema.extend({ type: z.literal("action_rejected"), commandId: CommandIdSchema, reason: z.string().min(1) }),
  EventEnvelopeSchema.extend({ type: z.literal("game_finished"), winner: z.string().min(1) }),
]);

export type GameEvent = z.infer<typeof GameEventSchema>;
