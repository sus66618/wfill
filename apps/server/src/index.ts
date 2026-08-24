import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildServer } from "./app.js";

const environmentFile = resolve(".env");
// 本地开发时自动加载根目录密钥文件；已有进程环境变量保持更高优先级。
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);

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
