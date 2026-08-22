import { GameIdSchema, SeatIdSchema, type SessionUpdate, type SpectatorMode } from "@wfill/contracts";
import type { FastifyInstance } from "fastify";
import { once } from "node:events";
import { z } from "zod";
import type { SessionRegistry } from "../runtime/session-registry.js";

const paramsSchema = z.object({ gameId: GameIdSchema }).strict();
const querySchema = z.object({ view: z.string() }).strict();

const parseMode = (value: string): SpectatorMode | null => {
  if (value === "public" || value === "god") return { kind: value };
  if (!value.startsWith("seat:")) return null;
  const seat = SeatIdSchema.safeParse(Number(value.slice(5)));
  return seat.success ? { kind: "seat", seat: seat.data } : null;
};

export interface SessionEventsOptions { readonly heartbeatIntervalMs: number }

export const registerSessionEventRoutes = async (
  app: FastifyInstance,
  registry: SessionRegistry,
  options: SessionEventsOptions,
): Promise<void> => {
  const closeConnections = new Set<() => void>();
  app.addHook("onClose", async () => {
    for (const close of [...closeConnections]) close();
  });

  app.get("/api/sessions/:gameId/events", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const query = querySchema.safeParse(request.query);
    const mode = query.success ? parseMode(query.data.view) : null;
    if (!params.success || !mode) return reply.code(400).send({ error: "invalid_event_view" });

    const rawLastId = request.headers["last-event-id"];
    const lastId = rawLastId === undefined ? 0 : Number(rawLastId);
    if (!Number.isInteger(lastId) || lastId < 0) return reply.code(400).send({ error: "invalid_last_event_id" });

    try {
      registry.view(params.data.gameId);
    } catch {
      return reply.code(404).send({ error: "session_not_found" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    let sentSequence = lastId;
    let closed = false;
    const pending: SessionUpdate[] = [];
    const writeUpdate = (update: SessionUpdate): boolean => {
      if (closed || update.sequence <= sentSequence) return true;
      const writable = reply.raw.write(`id: ${update.sequence}\nevent: ${update.type}\ndata: ${JSON.stringify(update)}\n\n`);
      sentSequence = update.sequence;
      return writable;
    };
    const captured = registry.lastUpdateSequence(params.data.gameId);
    const dispose = registry.subscribe(params.data.gameId, mode, (update) => {
      if (update.sequence > captured) pending.push(update);
      if (pending.length > 100) close();
      else if (sentSequence >= captured && !writeUpdate(update)) close();
    });
    const heartbeat = setInterval(() => {
      if (!closed && !reply.raw.write(": heartbeat\n\n")) close();
    }, options.heartbeatIntervalMs);
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      dispose();
      closeConnections.delete(close);
      reply.raw.end();
    };
    closeConnections.add(close);
    request.raw.once("close", close);

    for (const update of registry.readUpdatesAfter(params.data.gameId, lastId, mode)) {
      if (update.sequence <= captured && !writeUpdate(update) && !closed) await once(reply.raw, "drain");
    }
    for (const update of pending.splice(0)) {
      if (!writeUpdate(update)) close();
    }
  });
};
