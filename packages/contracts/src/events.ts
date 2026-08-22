import { z } from "zod";
import { CommandIdSchema, EventIdSchema, GameIdSchema, SeatIdSchema } from "./ids.js";

export const EventAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("private"), seat: SeatIdSchema }),
  z.object({ kind: z.literal("god") }),
]);

export type EventAudience = z.infer<typeof EventAudienceSchema>;

const PrivateEventAudienceSchema = z.object({
  kind: z.literal("private"),
  seat: SeatIdSchema,
});

const PublicEventAudienceSchema = z.object({
  kind: z.literal("public"),
});

const requireMatchingAudienceSeat = (
  audienceSeat: number,
  expectedSeat: number,
  context: z.RefinementCtx,
): void => {
  if (audienceSeat !== expectedSeat) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audience", "seat"],
      message: "private_event_audience_must_match_seat",
    });
  }
};

const NightActionSchema = z.enum([
  "submit_wolf_kill",
  "inspect_player",
  "use_antidote",
  "use_poison",
  "pass_action",
]);

export const DeathCauseSchema = z.enum([
  "wolf_kill",
  "exile",
  "poison",
  "self_destruct",
]);

export type DeathCause = z.infer<typeof DeathCauseSchema>;

const EventEnvelopeSchema = z.object({
  eventId: EventIdSchema,
  gameId: GameIdSchema,
  version: z.number().int().min(0),
  audience: EventAudienceSchema,
  commandId: CommandIdSchema.optional(),
  rulesetId: z.string().min(1).optional(),
  rulesetVersion: z.string().min(1).optional(),
  dayNumber: z.number().int().min(0).optional(),
  phase: z.string().min(1).optional(),
});

const VoteBallotSchema = z.object({
  actorSeat: SeatIdSchema,
  targetSeat: SeatIdSchema.nullable(),
});

const VoteTallyEntrySchema = z.object({
  targetSeat: SeatIdSchema,
  votes: z.number().int().min(0),
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
  EventEnvelopeSchema.extend({
    type: z.literal("game_created"),
    audience: PublicEventAudienceSchema,
  }),
  RoleAssignedEventSchema,
  EventEnvelopeSchema.extend({
    type: z.literal("phase_advanced"),
    phase: z.string().min(1),
    audience: PublicEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("speech_published"),
    seat: SeatIdSchema,
    content: z.string().min(1),
    audience: PublicEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("vote_accepted"),
    actorSeat: SeatIdSchema,
    targetSeat: SeatIdSchema.nullable(),
    audience: PrivateEventAudienceSchema,
  }).superRefine((event, context) => {
    requireMatchingAudienceSeat(event.audience.seat, event.actorSeat, context);
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("vote_revealed"),
    roundKind: z.enum(["exile", "pk"]),
    roundVersion: z.number().int().min(0),
    ballots: z.array(VoteBallotSchema),
    tally: z.array(VoteTallyEntrySchema),
    audience: PublicEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("pk_round_opened"),
    candidateSeats: z.array(SeatIdSchema),
    eligibleVoterSeats: z.array(SeatIdSchema),
    audience: PublicEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("vote_tied_no_exile"),
    tiedCandidateSeats: z.array(SeatIdSchema),
    audience: PublicEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("exile_opened"),
    exiledSeat: SeatIdSchema,
    audience: PublicEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("action_rejected"),
    commandId: CommandIdSchema,
    reason: z.string().min(1),
    actorSeat: SeatIdSchema,
    audience: PrivateEventAudienceSchema,
  }).superRefine((event, context) => {
    requireMatchingAudienceSeat(event.audience.seat, event.actorSeat, context);
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("night_action_recorded"),
    actorSeat: SeatIdSchema,
    action: NightActionSchema,
    targetSeat: SeatIdSchema.optional(),
    audience: PrivateEventAudienceSchema,
  }).superRefine((event, context) => {
    requireMatchingAudienceSeat(event.audience.seat, event.actorSeat, context);
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("wolf_decision"),
    targetSeat: SeatIdSchema.nullable(),
    recipientSeat: SeatIdSchema,
    audience: PrivateEventAudienceSchema,
  }).superRefine((event, context) => {
    requireMatchingAudienceSeat(event.audience.seat, event.recipientSeat, context);
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("inspection_result"),
    actorSeat: SeatIdSchema,
    targetSeat: SeatIdSchema,
    faction: z.enum(["good", "werewolf"]),
    audience: PrivateEventAudienceSchema,
  }).superRefine((event, context) => {
    requireMatchingAudienceSeat(event.audience.seat, event.actorSeat, context);
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("night_resolved"),
    eliminatedSeats: z.array(SeatIdSchema),
    audience: PublicEventAudienceSchema,
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("player_eliminated"),
    seat: SeatIdSchema,
    audience: PublicEventAudienceSchema,
  }).strict(),
  EventEnvelopeSchema.extend({
    type: z.literal("elimination_cause_recorded"),
    seat: SeatIdSchema,
    cause: DeathCauseSchema,
    audience: z.object({ kind: z.literal("god") }),
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("command_committed"),
    commandId: CommandIdSchema,
    state: z.record(z.string(), z.unknown()),
    audience: z.object({ kind: z.literal("god") }),
  }),
  EventEnvelopeSchema.extend({
    type: z.literal("game_finished"),
    winner: z.enum(["good", "werewolf"]),
    audience: PublicEventAudienceSchema,
  }),
]);

export type GameEvent = z.infer<typeof GameEventSchema>;

export const filterEventsForAudience = (
  events: readonly GameEvent[],
  audience: EventAudience,
): GameEvent[] => events.filter((event) =>
  audience.kind === "god"
  || event.audience.kind === "public"
  || (audience.kind === "private"
    && event.audience.kind === "private"
    && event.audience.seat === audience.seat),
);
