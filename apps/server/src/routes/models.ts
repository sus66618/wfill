import type { FastifyInstance } from "fastify";
import type { ModelRuntime } from "../runtime/model-runtime.js";

const errorCodeFor = (error: unknown): { status: number; code: string } => {
  if (error instanceof Error && error.message === "credential_not_configured") {
    return { status: 409, code: error.message };
  }
  if (error instanceof Error && error.message === "model_not_found") {
    return { status: 404, code: error.message };
  }
  return { status: 500, code: "model_runtime_error" };
};

export const registerModelRoutes = async (app: FastifyInstance, runtime: ModelRuntime): Promise<void> => {
  app.get("/api/models", async () => ({
    configured: runtime.configured(),
    account: {
      accountId: runtime.account.accountId,
      displayName: runtime.account.displayName,
      baseUrl: runtime.account.baseUrl,
    },
    models: runtime.catalog(),
  }));

  app.post("/api/models/check-all", async (_request, reply) => {
    try {
      return { models: await runtime.checkAll() };
    } catch (error) {
      const mapped = errorCodeFor(error);
      return reply.code(mapped.status).send({ error: mapped.code });
    }
  });

  app.post<{ Params: { modelId: string } }>("/api/models/:modelId/check", async (request, reply) => {
    try {
      return await runtime.check(request.params.modelId);
    } catch (error) {
      const mapped = errorCodeFor(error);
      return reply.code(mapped.status).send({ error: mapped.code });
    }
  });
};
