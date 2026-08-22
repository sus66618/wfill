import { createGame, restoreFromAuditJournal } from "@wfill/game-engine";

if (typeof createGame !== "function" || typeof restoreFromAuditJournal !== "function") {
  throw new Error("raw_package_import_failed");
}

console.log("RAW_PACKAGE_IMPORT_OK");
