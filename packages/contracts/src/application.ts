import { z } from "zod";
import { GameIdSchema, SeatIdSchema } from "./ids.js";

export const spectatorModeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }).strict(),
  z.object({ kind: z.literal("seat"), seat: SeatIdSchema }).strict(),
  z.object({ kind: z.literal("god") }).strict(),
]);

export const gamePhaseSchema = z.enum([
  "night_wolf_discussion",
  "night_wolf_final_confirmation",
  "night_seer_action",
  "night_witch_action",
  "dawn",
  "dawn_last_words",
  "day_speech",
  "day_vote",
  "day_pk_speech",
  "day_pk_vote",
  "day_exile_last_words",
  "day_self_destruct_last_words",
  "settlement",
]);

export const visibleRoleSchema = z.object({
  roleId: z.string().min(1),
  source: z.enum(["self", "wolf_team", "god"]),
}).strict();

export const seatViewSchema = z.object({
  seat: SeatIdSchema,
  alive: z.boolean(),
  isCurrentActor: z.boolean(),
  visibleRole: visibleRoleSchema.optional(),
  witchResources: z.object({
    antidoteAvailable: z.boolean(),
    poisonAvailable: z.boolean(),
  }).strict().optional(),
}).strict();

const timelineEnvelopeSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(0),
  day: z.number().int().min(0),
});

export const timelineItemSchema = z.discriminatedUnion("kind", [
  timelineEnvelopeSchema.extend({ kind: z.literal("system"), text: z.string().min(1) }).strict(),
  timelineEnvelopeSchema.extend({
    kind: z.literal("speech"),
    seat: SeatIdSchema,
    content: z.string().min(1),
  }).strict(),
  timelineEnvelopeSchema.extend({
    kind: z.literal("vote"),
    ballots: z.array(z.object({ actorSeat: SeatIdSchema, targetSeat: SeatIdSchema.nullable() }).strict()),
  }).strict(),
  timelineEnvelopeSchema.extend({ kind: z.literal("elimination"), seat: SeatIdSchema }).strict(),
  timelineEnvelopeSchema.extend({
    kind: z.literal("death_detail"),
    seat: SeatIdSchema,
    cause: z.enum(["wolf_kill", "exile", "poison", "self_destruct"]),
  }).strict(),
  timelineEnvelopeSchema.extend({
    kind: z.literal("wolf_chat"),
    seat: SeatIdSchema,
    content: z.string().min(1),
  }).strict(),
  timelineEnvelopeSchema.extend({
    kind: z.literal("inspection"),
    actorSeat: SeatIdSchema,
    targetSeat: SeatIdSchema,
    faction: z.enum(["good", "werewolf"]),
  }).strict(),
  timelineEnvelopeSchema.extend({
    kind: z.literal("night_action"),
    actorSeat: SeatIdSchema,
    action: z.enum(["submit_wolf_kill", "inspect_player", "use_antidote", "use_poison", "pass_action"]),
    targetSeat: SeatIdSchema.optional(),
  }).strict(),
  timelineEnvelopeSchema.extend({
    kind: z.literal("wolf_decision"),
    targetSeat: SeatIdSchema.nullable(),
  }).strict(),
]);

export const gameViewSchema = z.object({
  gameId: GameIdSchema,
  version: z.number().int().min(0),
  day: z.number().int().min(0),
  phase: gamePhaseSchema,
  outcome: z.enum(["good_win", "wolf_win"]).nullable(),
  mode: spectatorModeSchema,
  seats: z.array(seatViewSchema),
  timeline: z.array(timelineItemSchema),
}).strict();

export const sessionControlSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("pause") }).strict(),
  z.object({ type: z.literal("resume") }).strict(),
  z.object({ type: z.literal("step") }).strict(),
]);

const updateEnvelopeSchema = z.object({
  sequence: z.number().int().positive(),
  gameId: GameIdSchema,
  audience: spectatorModeSchema,
});

export const sessionUpdateSchema = z.discriminatedUnion("type", [
  updateEnvelopeSchema.extend({ type: z.literal("view_snapshot"), view: gameViewSchema }).strict(),
  updateEnvelopeSchema.extend({ type: z.literal("timeline_appended"), item: timelineItemSchema }).strict(),
  updateEnvelopeSchema.extend({
    type: z.literal("runner_status"),
    mode: z.enum(["idle", "running", "paused", "finished", "failed"]),
    inFlight: z.boolean(),
  }).strict(),
  updateEnvelopeSchema.extend({ type: z.literal("connection_heartbeat") }).strict(),
]);

export type SpectatorMode = z.infer<typeof spectatorModeSchema>;
export type GameView = z.infer<typeof gameViewSchema>;
export type SeatView = z.infer<typeof seatViewSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type SessionControl = z.infer<typeof sessionControlSchema>;
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;
