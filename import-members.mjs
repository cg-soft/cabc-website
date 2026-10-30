// Operator-only CSV import. Existing credentials and registrations are never replaced.
import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, privateFile, validateMember, passwordHash, transaction } from "./db.mjs";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_MEMBERS = 5000;
const HEADERS = ["name", "email", "initial-password"];
export class ImportError extends Error {}

// Strict comma-separated CSV: quoted commas/newlines, doubled quotes, CRLF and BOM.
// Diagnostics name lines and validation rules, never raw field values.
export function parseCsv(text) {
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  const records = [];
  let field = "", fields = [], quoted = false, endedQuote = false;
  let line = 1, startLine = 1;
  const pushField = () => { fields.push(field); field = ""; endedQuote = false; };
  const pushRecord = () => {
    pushField();
    if (fields.some(value => value.trim() !== "")) records.push({ line: startLine, fields });
    if (records.length > MAX_MEMBERS + 1) throw new ImportError(`CSV exceeds ${MAX_MEMBERS} member rows.`);
    fields = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i], newline = c === "\r" || c === "\n";
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; endedQuote = true; }
      } else if (newline) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        field += "\n"; line++;
      } else field += c;
    } else if (c === ",") pushField();
    else if (newline) {
      pushRecord();
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++; startLine = line;
    } else if (c === '"' && field === "" && !endedQuote) quoted = true;
    else if (c === '"' || endedQuote)
      throw new ImportError(`CSV line ${line}: unexpected character beside a quote.`);
    else field += c;
  }
  if (quoted) throw new ImportError(`CSV record starting on line ${startLine}: unclosed quoted field.`);
  if (field !== "" || fields.length || endedQuote) pushRecord();
  if (!records.length) throw new ImportError("CSV is empty. Required header: name,email,initial-password");
  const header = records.shift().fields.map(value => value.trim().toLowerCase());
  if (header.length !== 3 || new Set(header).size !== 3 || HEADERS.some(name => !header.includes(name)))
    throw new ImportError("CSV must contain exactly these three unique headers: name,email,initial-password");
  if (!records.length) throw new ImportError("CSV has no member rows.");
  const rows = [], issues = [], seen = new Map();
  for (const record of records) {
    if (record.fields.length !== 3) { issues.push(`Line ${record.line}: expected exactly three columns.`); continue; }
    const values = Object.fromEntries(header.map((name, index) => [name, record.fields[index]]));
    try {
      if (/[\0]/.test(values.name + values.email))
        throw new ImportError("Names and email addresses cannot contain NUL characters.");
      if (/[\r\n\0]/.test(values["initial-password"]))
        throw new ImportError("Initial passwords cannot contain line breaks or NUL characters.");
      const member = validateMember({ name: values.name, email: values.email, password: values["initial-password"] });
      if (seen.has(member.email)) throw new ImportError(`Duplicate email within the CSV; first occurrence is on line ${seen.get(member.email)}.`);
      seen.set(member.email, record.line);
      rows.push({ ...member, line: record.line });
    } catch (error) { issues.push(`Line ${record.line}: ${error.message}`); }
  }
  if (issues.length) throw new ImportError(formatIssues(issues));
  return rows;
}
function formatIssues(issues) {
  return ["Import rejected; no accounts changed.", ...issues.slice(0, 50),
    ...(issues.length > 50 ? [`${issues.length - 50} additional validation errors.`] : [])].join("\n");
}
function privatePath(filename) {
  let resolved;
  try { resolved = privateFile(filename); }
  catch { throw new ImportError("Use a regular file outside public/build folders and web document roots; symlinked paths are not allowed."); }
  if (resolved.split(path.sep).some(part => ["public_html", "www", "htdocs"].includes(part)))
    throw new ImportError("Import and database files must be outside web document roots.");
  return resolved;
}
function sourceRows(filename) {
  const file = privatePath(filename);
  if (file === ROOT || file.startsWith(ROOT + path.sep))
    throw new ImportError("Keep the real CSV outside the application/repository directory.");
  let stat, buffer;
  try { stat = lstatSync(file); }
  catch { throw new ImportError("CSV file is missing or unreadable."); }
  if (!stat.isFile()) throw new ImportError("CSV must be a regular file.");
  if (stat.mode & 0o077) throw new ImportError("CSV contains passwords: set its permissions to 600 (or stricter) before importing.");
  if (stat.size > MAX_BYTES) throw new ImportError("CSV exceeds the 5 MB size limit.");
  try { buffer = readFileSync(file); }
  catch { throw new ImportError("CSV file is unreadable."); }
  if (buffer.length > MAX_BYTES) throw new ImportError("CSV exceeds the 5 MB size limit.");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { throw new ImportError("CSV must be valid UTF-8. Export it as CSV UTF-8."); }
  finally { buffer.fill(0); }
  return parseCsv(text);
}
function checkDatabase(db) {
  if (db.prepare("PRAGMA user_version").get().user_version !== 1)
    throw new ImportError("Expected the minimal CABC database, baseline version 1. No schema changes were made.");
  db.prepare("SELECT id,name,email,password,role FROM members LIMIT 0").all();
  if (db.prepare("SELECT value FROM metadata WHERE key='preview'").get()?.value === "1")
    throw new ImportError("Refusing to import credentials into the public fictional preview database.");
  const hasStatus = db.prepare("PRAGMA table_info(members)").all().some(c => c.name === "active");
  if (!db.prepare(`SELECT id FROM members WHERE role='admin'${hasStatus ? " AND active=1" : ""} LIMIT 1`).get())
    throw new ImportError("Create the initial administrator with node manage.mjs init before importing members.");
}
function planRows(db, rows, skipExisting) {
  checkDatabase(db);
  const existing = new Set(db.prepare("SELECT email FROM members").all().map(row => row.email.toLowerCase()));
  const fresh = [], issues = [];
  let skipped = 0;
  for (const row of rows) {
    if (existing.has(row.email)) {
      if (skipExisting) skipped++;
      else issues.push(`Line ${row.line}: email already exists. Use --skip-existing to leave that account unchanged.`);
    } else fresh.push(row);
  }
  if (issues.length) throw new ImportError(formatIssues(issues));
  return { fresh, skipped };
}
const counts = db => Object.fromEntries(["members", "games", "entries", "sessions"].map(
  table => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));

export function importMembers({ csvPath, database = process.env.DB_PATH || path.join(ROOT, "data/club.sqlite"),
  apply = false, skipExisting = false } = {}) {
  if (!csvPath) throw new ImportError("Provide a private CSV filename.");
  const file = privatePath(database);
  if (!existsSync(file)) throw new ImportError("Database not initialized or DB_PATH is wrong. Run node manage.mjs init for a new installation only.");
  const rows = sourceRows(csvPath);
  let db;
  let plan;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    plan = planRows(db, rows, skipExisting);
    const before = counts(db);
    if (!apply) return { dryRun: true, rows: rows.length, wouldAdd: plan.fresh.length, skipped: plan.skipped, before, after: before };
  } finally { db?.close(); db = undefined; }

  // Slow hashing happens before acquiring the write lock. Recheck the live
  // account set under the lock, then perform all inserts in one transaction.
  const hashes = new Map(plan.fresh.map(row => [row.email, passwordHash(row.password)]));
  if (!existsSync(file)) throw new ImportError("Database disappeared before import; no replacement was created.");
  try {
    db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    return transaction(db, () => {
      const current = planRows(db, rows, skipExisting), before = counts(db);
      const insert = db.prepare("INSERT INTO members(name,email,password,role) VALUES(?,?,?,'member')");
      for (const row of current.fresh) {
        if (!hashes.has(row.email)) throw new ImportError("Accounts changed during validation. Please run the dry run again.");
        insert.run(row.name, row.email, hashes.get(row.email));
      }
      const after = counts(db);
      if (after.members !== before.members + current.fresh.length ||
          ["games", "entries", "sessions"].some(table => after[table] !== before[table]))
        throw new ImportError("Unexpected record-count change; the import was rolled back.");
      return { dryRun: false, rows: rows.length, added: current.fresh.length, skipped: current.skipped, before, after };
    });
  } finally { db?.close(); hashes.clear(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const args = process.argv.slice(2);
  const usage = "Usage: node import-members.mjs PRIVATE.csv [--dry-run | --apply] [--skip-existing]";
  try {
    if (args.length === 1 && args[0] === "--help") console.log(usage);
    else {
      const files = args.filter(arg => !arg.startsWith("--"));
      const unknown = args.filter(arg => arg.startsWith("--") && !["--dry-run", "--apply", "--skip-existing"].includes(arg));
      if (files.length !== 1 || unknown.length || (args.includes("--dry-run") && args.includes("--apply")))
        throw new ImportError(usage);
      const result = importMembers({ csvPath: files[0], apply: args.includes("--apply"), skipExisting: args.includes("--skip-existing") });
      console.log(result.dryRun
        ? `DRY RUN: ${result.rows} rows valid; would add ${result.wouldAdd}; would skip ${result.skipped}. No accounts changed.`
        : `IMPORT COMPLETE: added ${result.added}; skipped ${result.skipped}. Existing accounts unchanged.`);
      console.log("Before:", result.before);
      console.log("After: ", result.after);
      if (result.dryRun) console.log("Review these counts, then repeat with --apply to import.");
    }
  } catch (error) {
    console.error(error instanceof ImportError ? error.message : "Import failed. Check the database, permissions and available disk space. No partial import was committed.");
    process.exitCode = 1;
  }
}
