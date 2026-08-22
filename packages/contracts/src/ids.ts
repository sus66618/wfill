import { z } from "zod";

export const GameIdSchema = z.string().min(1).brand<"GameId">();
export const CommandIdSchema = z.string().min(1).brand<"CommandId">();
export const EventIdSchema = z.string().min(1).brand<"EventId">();
export const SeatIdSchema = z.number().int().min(1).max(24);

export type GameId = z.infer<typeof GameIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type SeatId = z.infer<typeof SeatIdSchema>;
