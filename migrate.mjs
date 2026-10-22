// Explicit additive migration. Never run automatically at application startup.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, privateFile } from "./db.mjs";

export function migrateGameNames(filename = process.env.DB_PATH || path.join(ROOT, "data/club.sqlite")) {
  const file = privateFile(filename);
  if (!existsSync(file)) throw new Error("Database not found. Check DB_PATH; migration will not initialize a replacement.");
  const db = new DatabaseSync(file);
  let transaction = false;
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;");
    if (db.prepare("PRAGMA user_version").get().user_version !== 1)
      throw new Error("Unsupported database schema. Expected CABC baseline version 1.");
    const counts = () => Object.fromEntries(["members", "games", "entries", "sessions"].map(
      table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
    db.prepare("SELECT key,value FROM metadata LIMIT 0").all();
    db.exec("BEGIN IMMEDIATE"); transaction = true;
    const before = counts();
    const existing = db.prepare("PRAGMA table_info(games)").all().find(column => column.name === "name");
    if (existing && existing.type.toUpperCase() !== "TEXT")
      throw new Error("Existing games.name is not TEXT; migration requires manual review.");
    if (!existing) db.exec("ALTER TABLE games ADD COLUMN name TEXT NOT NULL DEFAULT ''");
    db.prepare("INSERT INTO metadata(key,value) VALUES('migration:001-game-names',?) ON CONFLICT(key) DO NOTHING")
      .run(new Date().toISOString());
    const after = counts();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Row counts changed; migration rolled back.");
    // Keep baseline user_version=1: old releases check it strictly. This optional
    // column is backward compatible; its migration ID lives in metadata instead.
    db.exec("COMMIT"); transaction = false;
    return { applied: !existing, before, after };
  } catch (error) {
    if (transaction) db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== "game-names") throw new Error("Usage: node migrate.mjs game-names");
    const result = migrateGameNames();
    console.log(result.applied ? "Game-name migration applied." : "Game-name column already present; no duplicate changes.");
    console.log("Before:", result.before);
    console.log("After: ", result.after);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
