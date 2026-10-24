import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, chmodSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA = 1;
export const hashToken = (token) => createHash("sha256").update(token).digest("hex");
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${hash.toString("hex")}`;
}
export function passwordMatches(password, stored) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = Buffer.from(passwordHash(password, salt).split(":")[1], "hex");
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}
export function privateFile(filename, create = false) {
  const absolute = path.resolve(filename);
  const publicRoot = path.join(ROOT, "public");
  if (absolute === publicRoot || absolute.startsWith(publicRoot + path.sep) ||
      absolute.split(path.sep).some((segment) => ["public", "preview", "dist", "node_modules"].includes(segment)))
    throw new Error("Database must be outside public and build directories.");
  for (let part = absolute; part !== path.dirname(part); part = path.dirname(part)) {
    if (existsSync(part) && lstatSync(part).isSymbolicLink()) throw new Error("Private database paths cannot contain symlinks.");
  }
  if (existsSync(absolute) && !lstatSync(absolute).isFile()) throw new Error("Database path must be a regular file.");
  if (create) mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  if (existsSync(path.dirname(absolute)) && realpathSync(path.dirname(absolute)).startsWith(publicRoot + path.sep))
    throw new Error("Database path is public.");
  return absolute;
}
export function openDatabase(filename = process.env.DB_PATH || path.join(ROOT, "data/club.sqlite"), initialize = false) {
  const file = privateFile(filename, initialize);
  if (!initialize && !existsSync(file)) throw new Error("Database not initialized. Run node manage.mjs init first.");
  const db = new DatabaseSync(file, { allowExtension: false });
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (initialize) {
      if (version !== 0 && version !== SCHEMA) throw new Error("Unsupported database version.");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(readFileSync(path.join(ROOT, "schema.sql"), "utf8"));
        // Only a genuinely new database gets the new feature schema here.
        // Existing databases always require the explicit migration command.
        if (version === 0) {
          db.exec("ALTER TABLE games ADD COLUMN event_type TEXT NOT NULL DEFAULT 'pairs' CHECK(event_type IN ('pairs','teams'))");
          db.exec(readFileSync(path.join(ROOT, "team-schema.sql"), "utf8"));
        }
        db.exec("COMMIT");
      }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    } else if (version !== SCHEMA) throw new Error("Incompatible database schema. Startup never migrates databases.");
    for (const table of ["members", "sessions", "games", "entries", "metadata"]) db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
    if (!db.prepare("PRAGMA table_info(games)").all().some(column => column.name === "name"))
      throw new Error("Game-name migration required. Run node migrate.mjs game-names with the same DB_PATH. Startup never migrates databases.");
    chmodSync(file, 0o600);
    db.exec("PRAGMA journal_mode=WAL;");
    return db;
  } catch (error) { db.close(); throw error; }
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const value = fn(); db.exec("COMMIT"); return value; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function validateMember(body) {
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (name.length < 2 || name.length > 80) throw new HttpError(400, "Enter a name between 2 and 80 characters.");
  if (email.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (password.length < 12 || password.length > 128) throw new HttpError(400, "Use a password of 12 to 128 characters.");
  return { name, email, password };
}
export function addMember(db, input, role = "member") {
  const { name, email, password } = validateMember(input);
  if (db.prepare("SELECT id FROM members WHERE email=?").get(email)) throw new HttpError(409, "That email address already has an account.");
  const result = db.prepare("INSERT INTO members(name,email,password,role) VALUES(?,?,?,?)")
    .run(name, email, passwordHash(password), role);
  return Number(result.lastInsertRowid);
}
export function clubToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
