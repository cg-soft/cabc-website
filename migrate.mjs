// Explicit additive migration. Never run automatically at application startup.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, privateFile, installMemberStatus } from "./db.mjs";

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
export function migrateMemberStatus(filename = process.env.DB_PATH || path.join(ROOT, "data/club.sqlite")) {
  const file = privateFile(filename);
  if (!existsSync(file)) throw new Error("Database not found. Check DB_PATH; migration will not initialize a replacement.");
  const db = new DatabaseSync(file);
  let pending = false;
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;");
    if (db.prepare("PRAGMA user_version").get().user_version !== 1)
      throw new Error("Unsupported database schema. Expected CABC baseline version 1.");
    db.exec("BEGIN IMMEDIATE"); pending = true;
    if (!db.prepare("PRAGMA table_info(games)").all().some(c => c.name === "event_type") ||
        !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_members'").get())
      throw new Error("Run node migrate.mjs team-events first.");
    const counts = () => Object.fromEntries(["members", "games", "entries", "sessions", "team_members"].map(
      table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
    const before = counts();
    const applied = installMemberStatus(db);
    db.prepare("INSERT INTO metadata(key,value) VALUES('migration:003-member-status',?) ON CONFLICT(key) DO NOTHING")
      .run(new Date().toISOString());
    const after = counts();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Row counts changed; migration rolled back.");
    db.exec("COMMIT"); pending = false;
    return { applied, before, after };
  } catch (error) {
    if (pending) db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
export function migrateRegistrationAudit(filename = process.env.DB_PATH || path.join(ROOT, "data/club.sqlite")) {
  const file = privateFile(filename);
  if (!existsSync(file)) throw new Error("Database not found. Check DB_PATH; migration will not initialize a replacement.");
  const db = new DatabaseSync(file);
  let pending = false;
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;");
    if (db.prepare("PRAGMA user_version").get().user_version !== 1)
      throw new Error("Unsupported database schema. Expected CABC baseline version 1.");
    db.exec("BEGIN IMMEDIATE"); pending = true;
    if (!db.prepare("PRAGMA table_info(members)").all().some(c => c.name === "active"))
      throw new Error("Run node migrate.mjs member-status first.");
    const counts = () => Object.fromEntries(["members", "games", "entries", "sessions", "team_members"].map(
      table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
    const before = counts();
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='registration_audit'").get();
    db.exec(readFileSync(path.join(ROOT, "registration-audit-schema.sql"), "utf8"));
    db.prepare("SELECT id,created_at,actor_id,actor_name,target_id,target_name,game_id,game_date,action,before_json,after_json FROM registration_audit LIMIT 0").all();
    db.prepare("INSERT INTO metadata(key,value) VALUES('migration:004-registration-audit',?) ON CONFLICT(key) DO NOTHING")
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
export function migrateNotifications(filename = process.env.DB_PATH || path.join(ROOT, "data/club.sqlite")) {
  const file = privateFile(filename);
  if (!existsSync(file)) throw new Error("Database not found. Check DB_PATH; migration will not initialize a replacement.");
  const db = new DatabaseSync(file);
  let pending = false;
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;");
    if (db.prepare("PRAGMA user_version").get().user_version !== 1)
      throw new Error("Unsupported database schema. Expected CABC baseline version 1.");
    db.exec("BEGIN IMMEDIATE"); pending = true;
    if (!db.prepare("PRAGMA table_info(members)").all().some(c => c.name === "active"))
      throw new Error("Run node migrate.mjs member-status first.");
    const counts = () => Object.fromEntries(["members", "games", "entries", "sessions", "team_members", "registration_audit"]
      .filter(table => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
      .map(table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
    const before = counts();
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notification_outbox'").get();
    db.exec(readFileSync(path.join(ROOT, "notification-schema.sql"), "utf8"));
    db.prepare("SELECT member_id,enabled,token,updated_at FROM notification_preferences LIMIT 0").all();
    db.prepare("SELECT id,event_id,member_id,email,payload_json,state,created_at,next_attempt,attempts,locked_until,last_error FROM notification_outbox LIMIT 0").all();
    db.prepare("INSERT INTO metadata(key,value) VALUES('migration:005-notifications',?) ON CONFLICT(key) DO NOTHING").run(new Date().toISOString());
    const after = counts();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Row counts changed; migration rolled back.");
    db.exec("COMMIT"); pending = false;
    return { applied: !existing, before, after };
  } catch (error) { if (pending) db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (!["game-names", "team-events", "member-status", "registration-audit", "notifications"].includes(command)) throw new Error("Usage: node migrate.mjs game-names | team-events | member-status | registration-audit | notifications");
    const result = command === "notifications" ? migrateNotifications() : command === "registration-audit" ? migrateRegistrationAudit() : command === "member-status" ? migrateMemberStatus() : command === "team-events" ? migrateTeamEvents() : migrateGameNames();
    console.log(result.applied ? `${command} migration applied.` : `${command} schema already present; no duplicate changes.`);
    console.log("Before:", result.before);
    console.log("After: ", result.after);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
