import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildServer } from "./app.js";

const host = process.env.WFILL_HOST ?? "127.0.0.1";
const port = Number(process.env.WFILL_PORT ?? "3210");
const dataDirectory = resolve(process.env.WFILL_DATA_DIR ?? "data/local");
mkdirSync(dataDirectory, { recursive: true });

const runtime = buildServer({ databasePath: resolve(dataDirectory, "wfill.sqlite") });

const shutdown = async (): Promise<void> => {
  await runtime.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await runtime.app.listen({ host, port });
console.log(`WFill local server: http://${host}:${port}`);
