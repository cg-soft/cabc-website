// Explicit additive migration. Never run automatically at application startup.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
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
export function migrateTeamEvents(filename = process.env.DB_PATH || path.join(ROOT, "data/club.sqlite")) {
  const file = privateFile(filename);
  if (!existsSync(file)) throw new Error("Database not found. Check DB_PATH; migration will not initialize a replacement.");
  const db = new DatabaseSync(file);
  let pending = false;
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;");
    if (db.prepare("PRAGMA user_version").get().user_version !== 1)
      throw new Error("Unsupported database schema. Expected CABC baseline version 1.");
    db.exec("BEGIN IMMEDIATE"); pending = true;
    const columns = db.prepare("PRAGMA table_info(games)").all();
    if (!columns.some(c => c.name === "name"))
      throw new Error("Run node migrate.mjs game-names first.");
    const existing = columns.find(c => c.name === "event_type");
    if (existing && (existing.type.toUpperCase() !== "TEXT" || !existing.notnull))
      throw new Error("Existing games.event_type requires manual review.");
    const counts = () => Object.fromEntries(["members", "games", "entries", "sessions"].map(
      table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
    const before = counts();
    if (!existing) db.exec("ALTER TABLE games ADD COLUMN event_type TEXT NOT NULL DEFAULT 'pairs' CHECK(event_type IN ('pairs','teams'))");
    if (db.prepare("SELECT id FROM games WHERE event_type NOT IN ('pairs','teams') OR event_type IS NULL LIMIT 1").get())
      throw new Error("Invalid event types require manual review.");
    db.exec(readFileSync(path.join(ROOT, "team-schema.sql"), "utf8"));
    db.prepare("SELECT game_id,member_id,team_id FROM team_members LIMIT 0").all();
    db.prepare("INSERT INTO metadata(key,value) VALUES('migration:002-team-events',?) ON CONFLICT(key) DO NOTHING")
      .run(new Date().toISOString());
    const after = counts();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Row counts changed; migration rolled back.");
    db.exec("COMMIT"); pending = false;
    return { applied: !existing, before, after };
  } catch (error) {
    if (pending) db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (!["game-names", "team-events"].includes(command)) throw new Error("Usage: node migrate.mjs game-names | team-events");
    const result = command === "team-events" ? migrateTeamEvents() : migrateGameNames();
    console.log(result.applied ? `${command} migration applied.` : `${command} schema already present; no duplicate changes.`);
    console.log("Before:", result.before);
    console.log("After: ", result.after);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
