import Database from "better-sqlite3";
import { existsSync, chmodSync } from "node:fs";
import { privatePath } from "../private-path";
import { assertCompatibleSchema, schemaVersion, SchemaCompatibilityError } from "../database";
import { SCHEMA_V3_SQL } from "./schema-v3";
import { REQUIRED_SCHEMA_VERSION } from "../../shared/release-contract";

export function databaseStatus(filename: string) {
  if (!existsSync(filename))
    return { exists: false, version: null, required: REQUIRED_SCHEMA_VERSION, compatible: false };
  const db = new Database(privatePath(filename, false), { readonly: true, fileMustExist: true });
  try {
    const version = schemaVersion(db);
    let compatible = false;
    try {
      assertCompatibleSchema(db);
      compatible = true;
    } catch (error) {
      if (!(error instanceof SchemaCompatibilityError)) throw error;
    }
    return { exists: true, version, required: REQUIRED_SCHEMA_VERSION, compatible };
  } finally {
    db.close();
  }
}

export function migrateDatabase(filename: string, options: { initialize?: boolean } = {}) {
  const existed = existsSync(filename);
  if (!existed && !options.initialize)
    throw new SchemaCompatibilityError(
      "Database is missing. Use --init only when intentionally creating a new database.",
    );
  const oldMask = process.umask(0o077);
  let db: Database.Database | undefined;
  try {
    db = new Database(privatePath(filename));
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    const connection = db;
    // Version is checked inside the write lock: concurrent migration processes
    // cannot replay a migration using a stale pre-lock version.
    const result = db
      .transaction(() => {
        const before = schemaVersion(connection);
        if (before === REQUIRED_SCHEMA_VERSION) {
          assertCompatibleSchema(connection);
          return { from: before, to: before, changed: false };
        }
        if (![0, 1, 2].includes(before))
          throw new SchemaCompatibilityError(
            "Unsupported database version. No migration was applied.",
          );
        const tables = connection
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all() as { name: string }[];
        if (options.initialize && tables.length > 0)
          throw new SchemaCompatibilityError(
            "Initialization is only for an empty database. Back up existing data and use the upgrade command.",
          );
        if (tables.length === 0 && !options.initialize)
          throw new SchemaCompatibilityError(
            "Empty database. Use --init only when intentionally initializing it.",
          );
        if (
          tables.length > 0 &&
          (!tables.some((t) => t.name === "users") || !tables.some((t) => t.name === "settings"))
        )
          throw new SchemaCompatibilityError(
            "Unrecognized legacy database. No migration was applied.",
          );
        if ((connection.pragma("foreign_key_check") as unknown[]).length)
          throw new SchemaCompatibilityError(
            "Database integrity check failed. No migration was applied.",
          );

        // Baseline includes legacy v0/v1/v2 tables. All DDL and backfill writes
        // are in this single transaction and roll back together on any error.
        connection.exec(SCHEMA_V3_SQL);
        const events = connection
          .prepare("SELECT id, date, title FROM events ORDER BY date, id")
          .all() as { id: number; date: string; title: string }[];
        const insertGame = connection.prepare(
          "INSERT INTO dance_games(date,title) VALUES (?,?) ON CONFLICT(date) DO NOTHING",
        );
        const findGame = connection.prepare("SELECT id FROM dance_games WHERE date=?");
        const attendance = connection.prepare(
          "INSERT INTO dance_attendance(game_id,user_id,attending) VALUES (?,?,1) ON CONFLICT(game_id,user_id) DO UPDATE SET attending=1",
        );
        const dateFormat = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Los_Angeles",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        for (const event of events) {
          const date = dateFormat.format(new Date(event.date));
          insertGame.run(date, event.title);
          const game = findGame.get(date) as { id: number };
          const rsvps = connection
            .prepare("SELECT user_id FROM rsvps WHERE event_id=?")
            .all(event.id) as { user_id: number }[];
          for (const rsvp of rsvps) attendance.run(game.id, rsvp.user_id);
        }
        const slots = connection
          .prepare("SELECT game_id,user_id FROM dance_slots WHERE status IN ('booked','standby')")
          .all() as { game_id: number; user_id: number }[];
        for (const slot of slots) attendance.run(slot.game_id, slot.user_id);
        if ((connection.pragma("foreign_key_check") as unknown[]).length)
          throw new SchemaCompatibilityError(
            "Migration integrity check failed. Changes were rolled back.",
          );
        connection.pragma(`user_version = ${REQUIRED_SCHEMA_VERSION}`);
        assertCompatibleSchema(connection);
        return { from: before, to: REQUIRED_SCHEMA_VERSION, changed: true };
      })
      .immediate();
    chmodSync(privatePath(filename, false), 0o600);
    return result;
  } finally {
    db?.close();
    process.umask(oldMask);
  }
}
