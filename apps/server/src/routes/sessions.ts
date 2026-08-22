import { randomUUID } from "node:crypto";
import { GameIdSchema, sessionControlSchema, type GameId } from "@wfill/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SessionRegistry } from "../runtime/session-registry.js";

const createSessionSchema = z.object({
  gameId: GameIdSchema.optional(),
  seed: z.enum(["good-win", "wolf-win"]),
}).strict();

const paramsSchema = z.object({ gameId: GameIdSchema }).strict();

const errorBody = (code: string) => ({ error: code });

export const registerSessionRoutes = async (app: FastifyInstance, registry: SessionRegistry): Promise<void> => {
  app.post("/api/sessions", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(errorBody("invalid_request"));
    const gameId = parsed.data.gameId ?? GameIdSchema.parse(randomUUID());
    try {
      const view = registry.create(gameId, parsed.data.seed);
      return reply.code(201).send({ view, runner: { mode: "idle", inFlight: false } });
    } catch (error) {
      if (error instanceof Error && error.message === "session_already_exists") {
        return reply.code(409).send(errorBody(error.message));
      }
      throw error;
    }
  });

  app.get("/api/sessions", async () => ({ sessions: registry.list() }));

  app.get("/api/sessions/:gameId", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(errorBody("invalid_game_id"));
    try {
      return { view: registry.view(parsed.data.gameId) };
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send(errorBody(error.message));
      }
      throw error;
    }
  });

  app.post("/api/sessions/:gameId/control", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const control = sessionControlSchema.safeParse(request.body);
    if (!params.success || !control.success) return reply.code(400).send(errorBody("invalid_request"));
    try {
      return await registry.control(params.data.gameId as GameId, control.data);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not_found")) {
        return reply.code(404).send(errorBody("session_not_found"));
      }
      if (error instanceof Error && error.name === "SessionRecoveryError") {
        return reply.code(409).send(errorBody("session_recovery_failed"));
      }
      throw error;
    }
  });
};
