import Fastify, { type FastifyInstance } from "fastify";
import { openSqliteDatabase } from "@wfill/persistence";
import { registerSessionRoutes } from "./routes/sessions.js";
import { SessionRegistry } from "./runtime/session-registry.js";

export interface BuildServerOptions { readonly databasePath: string }

export interface ServerRuntime {
  readonly app: FastifyInstance;
  readonly registry: SessionRegistry;
  close(): Promise<void>;
}

export const buildServer = (options: BuildServerOptions): ServerRuntime => {
  const database = openSqliteDatabase(options.databasePath);
  const registry = new SessionRegistry(database);
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok" }));
  void app.register(async (scope) => registerSessionRoutes(scope, registry));

  let closed = false;
  return {
    app,
    registry,
    async close() {
      if (closed) return;
      closed = true;
      await registry.close();
      await app.close();
      registry.repository.close();
    },
  };
};
