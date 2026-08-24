import Fastify, { type FastifyInstance } from "fastify";
import type { ModelTextGateway } from "@wfill/application";
import { openSqliteDatabase } from "@wfill/persistence";
import { EnvCredentialVault, OpenAiCompatibleClient } from "@wfill/model-gateway";
import type { ModelRuntimeGateway } from "./runtime/model-runtime.js";
import { ModelRuntime } from "./runtime/model-runtime.js";
import { SqliteModelRepository } from "@wfill/persistence";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerSessionEventRoutes } from "./routes/session-events.js";
import { SessionRegistry } from "./runtime/session-registry.js";
import { registerModelRoutes } from "./routes/models.js";

export interface BuildServerOptions {
  readonly databasePath: string;
  readonly heartbeatIntervalMs?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly modelGateway?: ModelRuntimeGateway;
}

export interface ServerRuntime {
  readonly app: FastifyInstance;
  readonly registry: SessionRegistry;
  readonly models: ModelRuntime;
  close(): Promise<void>;
}

export const buildServer = (options: BuildServerOptions): ServerRuntime => {
  const database = openSqliteDatabase(options.databasePath);
  const environment = options.environment ?? process.env;
  const credentialVault = new EnvCredentialVault(environment);
  const gateway = options.modelGateway ?? new OpenAiCompatibleClient({ credentialVault });
  const modelRepository = new SqliteModelRepository(database);
  const models = new ModelRuntime({
    repository: modelRepository,
    credentialVault,
    gateway,
    environment,
  });
  const registry = new SessionRegistry(database, {
    modelRepository,
    account: models.account,
    gateway: gateway as ModelTextGateway,
    credentialVault,
  });
  const app = Fastify({ logger: false, keepAliveTimeout: 100, forceCloseConnections: true });
  app.get("/health", async () => ({ status: "ok" }));
  void app.register(async (scope) => registerSessionRoutes(scope, registry));
  void app.register(async (scope) => registerSessionEventRoutes(scope, registry, {
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15_000,
  }));
  void app.register(async (scope) => registerModelRoutes(scope, models));

  let closed = false;
  return {
    app,
    registry,
    models,
    async close() {
      if (closed) return;
      closed = true;
      await registry.close();
      await app.close();
      registry.repository.close();
    },
  };
};
