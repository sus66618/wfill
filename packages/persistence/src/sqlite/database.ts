import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";

export const openSqliteDatabase = (path: string): DatabaseSync => {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  runMigrations(database);
  return database;
};

