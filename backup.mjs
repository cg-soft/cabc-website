// Consistent, encrypted SQLite backups. No npm packages or shell utilities needed.
import * as sqlite from "node:sqlite";
import {
  existsSync, mkdirSync, mkdtempSync, lstatSync, readFileSync, writeFileSync,
  readdirSync, rmSync, unlinkSync, linkSync, openSync, closeSync, fsyncSync,
  readSync, appendFileSync, createReadStream, createWriteStream
} from "node:fs";
import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual, createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, privateFile } from "./db.mjs";

const MAGIC = Buffer.from("CABCBAK1");
const HEADER_BYTES = 20; // Versioned magic + 12-byte random IV.
const TAG_BYTES = 16;
const NAME = /^cabc-\d{8}T\d{9}Z-[a-f0-9]{16}\.sqlite\.enc$/;
const workspaces = new Set();
const locks = new Set();
const within = (file, dir) => file === dir || file.startsWith(dir + path.sep);

function safePath(value) {
  const resolved = privateFile(value);
  if (resolved.split(path.sep).some(part => ["public_html", "www", "htdocs"].includes(part)))
    throw new Error("Backup paths must be outside web document roots.");
  return resolved;
}
function privateDirectory(directory) {
  safePath(path.join(directory, ".path-check"));
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077))
    throw new Error(`Private directory must have permissions 700: ${directory}`);
}
function privateRegularFile(filename) {
  safePath(filename);
  const stat = lstatSync(filename);
  if (!stat.isFile() || (stat.mode & 0o077))
    throw new Error(`Private file must have permissions 600 (or stricter): ${filename}`);
  return stat;
}
export function configuration(env = process.env) {
  const database = safePath(env.DB_PATH || path.join(ROOT, "data/club.sqlite"));
  const directory = path.dirname(safePath(path.join(path.resolve(env.BACKUP_DIR || path.join(path.dirname(database), "backups")), ".path-check")));
  const keyFile = safePath(env.BACKUP_KEY_PATH || path.join(path.dirname(database), "backup-key.hex"));
  const keep = Number(env.BACKUP_KEEP || 12);
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 1000)
    throw new Error("BACKUP_KEEP must be an integer from 1 to 1000.");
  if (within(database, directory) || within(keyFile, directory) || database === keyFile)
    throw new Error("Keep the live database and encryption key outside the backup directory.");
  return { database, directory, keyFile, keep };
}
function keyFor(config) {
  if (!existsSync(config.keyFile)) throw new Error("Backup key is missing. Run setup once, or recover your original key.");
  privateRegularFile(config.keyFile);
  const hex = readFileSync(config.keyFile, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("Backup key must contain exactly 64 hexadecimal characters.");
  return Buffer.from(hex, "hex");
}
function syncFile(filename) {
  const fd = openSync(filename, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(directory) {
  const fd = openSync(directory, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function temporary(directory) {
  const folder = mkdtempSync(path.join(directory, ".cabc-work-"));
  workspaces.add(folder);
  return folder;
}
function removeTemporary(folder) {
  rmSync(folder, { recursive: true, force: true });
  workspaces.delete(folder);
}
function inspectDatabase(filename) {
  const db = new sqlite.DatabaseSync(filename, { readOnly: true });
  try {
    const checks = db.prepare("PRAGMA quick_check").all();
    if (checks.length !== 1 || checks[0].quick_check !== "ok")
      throw new Error("SQLite integrity verification failed.");
    if (db.prepare("PRAGMA user_version").get().user_version !== 1)
      throw new Error("Backup utility expects CABC schema version 1.");
    for (const table of ["members", "sessions", "games", "entries", "metadata"])
      db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("SQLite foreign-key verification failed.");
    if (db.prepare("SELECT value FROM metadata WHERE key='preview'").get()?.value === "1")
      throw new Error("Production backups must not use a fictional preview database.");
  } finally { db.close(); }
}
async function digest(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest();
}
async function encrypt(input, output, key) {
  const header = Buffer.concat([MAGIC, randomBytes(12)]);
  const cipher = createCipheriv("aes-256-gcm", key, header.subarray(8));
  cipher.setAAD(header);
  writeFileSync(output, header, { flag: "wx", mode: 0o600 });
  await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: "a", mode: 0o600 }));
  appendFileSync(output, cipher.getAuthTag());
  syncFile(output);
}
async function decrypt(input, output, key) {
  const stat = privateRegularFile(input);
  if (stat.size <= HEADER_BYTES + TAG_BYTES) throw new Error("Encrypted backup is truncated.");
  const header = Buffer.alloc(HEADER_BYTES), tag = Buffer.alloc(TAG_BYTES);
  const fd = openSync(input, "r");
  try {
    if (readSync(fd, header, 0, header.length, 0) !== header.length ||
        readSync(fd, tag, 0, tag.length, stat.size - TAG_BYTES) !== tag.length)
      throw new Error("Cannot read encrypted backup.");
  } finally { closeSync(fd); }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error("Unknown encrypted backup format.");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(input, { start: HEADER_BYTES, end: stat.size - TAG_BYTES - 1 }),
      decipher, createWriteStream(output, { flags: "wx", mode: 0o600 })
    );
  } catch {
    throw new Error("Backup authentication failed: incorrect key, corrupted backup, or read/write failure.");
  }
  inspectDatabase(output);
}
export function setup(config = configuration()) {
  // Setup never initializes or modifies the live database.
  if (!existsSync(config.database)) throw new Error("Live database not found. Check DB_PATH; do not initialize a replacement.");
  privateRegularFile(config.database);
  inspectDatabase(config.database);
  privateDirectory(config.directory);
  privateDirectory(path.dirname(config.keyFile));
  if (!existsSync(config.keyFile)) {
    if (readdirSync(config.directory).some(name => NAME.test(name)))
      throw new Error("Backups already exist but the key is missing. Recover the original key; do not generate a replacement.");
    writeFileSync(config.keyFile, randomBytes(32).toString("hex") + "\n", { flag: "wx", mode: 0o600 });
    syncFile(config.keyFile);
    syncDirectory(path.dirname(config.keyFile));
  }
  keyFor(config).fill(0);
}
export async function runBackup(config = configuration()) {
  if (typeof sqlite.backup !== "function") throw new Error("This Node runtime lacks SQLite backup(). Use the tested Node 22.23.2 runtime or a compatible newer runtime.");
  if (!existsSync(config.database)) throw new Error("Live database not found. Check DB_PATH.");
  privateRegularFile(config.database);
  const key = keyFor(config);
  privateDirectory(config.directory);
  const lock = path.join(config.directory, ".backup.lock");
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("Backup lock exists. Another backup may be running; inspect it before clearing a stale lock.");
    throw error;
  }
  locks.add(lock);
  let work;
  try {
    writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }), { mode: 0o600 });
    work = temporary(config.directory);
    const snapshot = path.join(work, "snapshot.sqlite");
    const db = new sqlite.DatabaseSync(config.database, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout=10000");
      await sqlite.backup(db, snapshot);
    } finally { db.close(); }
    inspectDatabase(snapshot);
    const encrypted = path.join(work, "encrypted.part");
    await encrypt(snapshot, encrypted, key);
    const roundTrip = path.join(work, "verify.sqlite");
    await decrypt(encrypted, roundTrip, key);
    if (!timingSafeEqual(await digest(snapshot), await digest(roundTrip)))
      throw new Error("Backup round-trip verification failed.");
    const stamp = new Date().toISOString().replace(/[-:.]/g, "");
    const published = path.join(config.directory, `cabc-${stamp}-${randomBytes(8).toString("hex")}.sqlite.enc`);
    // A hard link atomically publishes the verified file without overwriting anything.
    linkSync(encrypted, published);
    syncDirectory(config.directory);
    const copies = readdirSync(config.directory).filter(name => {
      if (!NAME.test(name)) return false;
      const stat = lstatSync(path.join(config.directory, name));
      return stat.isFile() && !stat.isSymbolicLink();
    }).sort().reverse();
    const removed = [];
    for (const name of copies.slice(config.keep)) {
      const filename = path.join(config.directory, name);
      const stat = lstatSync(filename);
      if (stat.isFile() && !stat.isSymbolicLink()) { unlinkSync(filename); removed.push(name); }
    }
    syncDirectory(config.directory);
    return { file: published, pruned: removed.length };
  } finally {
    try { if (work) removeTemporary(work); }
    finally { rmSync(lock, { recursive: true, force: true }); locks.delete(lock); key.fill(0); }
  }
}
export async function verifyBackup(input, config = configuration()) {
  const key = keyFor(config);
  privateDirectory(config.directory);
  const work = temporary(config.directory);
  try { await decrypt(safePath(input), path.join(work, "verified.sqlite"), key); }
  finally { removeTemporary(work); key.fill(0); }
}
export async function restoreCopy(input, destination, config = configuration()) {
  const output = safePath(destination);
  if (output === config.database || output === config.keyFile || existsSync(output) ||
      existsSync(output + "-wal") || existsSync(output + "-shm"))
    throw new Error("Restore requires a new private filename, never the live database or an existing file.");
  const key = keyFor(config);
  privateDirectory(path.dirname(output));
  const work = temporary(path.dirname(output));
  try {
    const restored = path.join(work, "restored.sqlite");
    await decrypt(safePath(input), restored, key);
    syncFile(restored);
    linkSync(restored, output);
    syncDirectory(path.dirname(output));
  } finally { removeTemporary(work); key.fill(0); }
}
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
export function cronLine(config = configuration()) {
  const pieces = [process.execPath, path.join(ROOT, "backup.mjs"), "run"];
  const env = { DB_PATH: config.database, BACKUP_DIR: config.directory, BACKUP_KEY_PATH: config.keyFile, BACKUP_KEEP: config.keep };
  const command = "/usr/bin/env " + Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`).join(" ") +
    " " + pieces.map(quote).join(" ");
  if (/[\r\n%]/.test(command)) throw new Error("Cron paths must not contain newlines or percent signs.");
  return "0 3 * * 0 " + command;
}
function cleanExit(code) {
  for (const work of workspaces) rmSync(work, { recursive: true, force: true });
  for (const lock of locks) rmSync(lock, { recursive: true, force: true });
  process.exit(code);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  process.once("SIGTERM", () => cleanExit(143));
  process.once("SIGINT", () => cleanExit(130));
  const timeout = setTimeout(() => {
    console.error("CABC backup failed: exceeded the 10-minute limit.");
    cleanExit(124);
  }, 600000);
  timeout.unref();
  try {
    const config = configuration(), [command, input, output] = process.argv.slice(2);
    if (command === "setup") {
      setup(config);
      console.log(`Backup setup ready. Keep a secure offline copy of ${config.keyFile}; it is required for recovery.`);
    } else if (command === "run") {
      const result = await runBackup(config);
      console.log(`CABC backup verified: ${result.file}; older copies removed: ${result.pruned}`);
    } else if (command === "verify" && input) {
      await verifyBackup(input, config);
      console.log("CABC backup authentication and SQLite integrity checks passed.");
    } else if (command === "restore" && input && output) {
      await restoreCopy(input, output, config);
      console.log(`Verified recovery copy created: ${path.resolve(output)}. Live database unchanged.`);
    } else if (command === "cron") console.log(cronLine(config));
    else throw new Error("Usage: node backup.mjs setup | run | cron | verify BACKUP | restore BACKUP NEW_PRIVATE_FILE");
  } catch (error) {
    console.error(`CABC backup failed: ${error.message}`);
    process.exitCode = 1;
  } finally { clearTimeout(timeout); }
}
