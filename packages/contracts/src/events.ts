import { z } from "zod";
import { CommandIdSchema, EventIdSchema, GameIdSchema, SeatIdSchema } from "./ids.js";

export const EventAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("private"), seat: SeatIdSchema }),
]);

export type EventAudience = z.infer<typeof EventAudienceSchema>;

const PrivateEventAudienceSchema = z.object({
  kind: z.literal("private"),
  seat: SeatIdSchema,
});

const NightActionSchema = z.enum([
  "submit_wolf_kill",
  "inspect_player",
  "use_antidote",
  "use_poison",
  "pass_action",
]);

const EventEnvelopeSchema = z.object({
  eventId: EventIdSchema,
  gameId: GameIdSchema,
  version: z.number().int().min(0),
  audience: EventAudienceSchema,
});

const RoleAssignedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("role_assigned"),
  seat: SeatIdSchema,
  role: z.string().min(1),
  audience: PrivateEventAudienceSchema,
}).superRefine((event, context) => {
  if (event.audience.seat !== event.seat) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audience", "seat"],
      message: "role_assignment_audience_must_match_seat",
    });
  }
});

export const GameEventSchema = z.union([
  EventEnvelopeSchema.extend({ type: z.literal("game_created") }),
  RoleAssignedEventSchema,
  EventEnvelopeSchema.extend({ type: z.literal("phase_advanced"), phase: z.string().min(1) }),
  EventEnvelopeSchema.extend({ type: z.literal("speech_published"), seat: SeatIdSchema, content: z.string().min(1) }),
  EventEnvelopeSchema.extend({ type: z.literal("vote_accepted"), actorSeat: SeatIdSchema, targetSeat: SeatIdSchema }),
  EventEnvelopeSchema.extend({ type: z.literal("action_rejected"), commandId: CommandIdSchema, reason: z.string().min(1) }),
  EventEnvelopeSchema.extend({
    type: z.literal("night_action_recorded"),
    actorSeat: SeatIdSchema,
    action: NightActionSchema,
    audience: PrivateEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("wolf_decision"),
    targetSeat: SeatIdSchema.nullable(),
    audience: PrivateEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("inspection_result"),
    actorSeat: SeatIdSchema,
    targetSeat: SeatIdSchema,
    faction: z.enum(["good", "werewolf"]),
    audience: PrivateEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("night_resolved"),
    eliminatedSeats: z.array(SeatIdSchema),
  }),
  EventEnvelopeSchema.extend({ type: z.literal("game_finished"), winner: z.string().min(1) }),
]);

export type GameEvent = z.infer<typeof GameEventSchema>;

export const filterEventsForAudience = (
  events: readonly GameEvent[],
  audience: EventAudience,
): GameEvent[] => events.filter((event) =>
  event.audience.kind === "public"
  || (audience.kind === "private"
    && event.audience.kind === "private"
    && event.audience.seat === audience.seat),
);
