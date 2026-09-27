import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseStorage } from "../server/storage";
import { databaseStatus, migrateDatabase } from "../server/migrations";
import { SCHEMA_V3_SQL } from "../server/migrations/schema-v3";

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cabc-migration-"));
  return {
    dir,
    db: path.join(dir, "club.sqlite"),
    setup: path.join(dir, "private", "setup.txt"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
function legacy(filename: string, version = 2, invalidDate = false) {
  const db = new Database(filename);
  db.exec(SCHEMA_V3_SQL);
  db.exec(`
    INSERT INTO users(id,name,email,password_hash,role) VALUES
      (1,'Owner','owner@example.test','preserved-password-hash','admin'),
      (2,'Partner','partner@example.test','partner-hash','member');
    INSERT INTO settings VALUES(1,'Preserved Club','about','venue','mail@example.test','schedule');
    INSERT INTO bootstrap VALUES(1,'consumed-bootstrap',1234);
    INSERT INTO sessions VALUES('preserved-session',1,9999999999999);
    INSERT INTO invitations(email,code_hash,expires_at) VALUES('invite@example.test','invitation-hash',9999999999999);
    INSERT INTO password_resets(user_id,code_hash,expires_at) VALUES(1,'recovery-hash',9999999999999);
    INSERT INTO dance_games VALUES(5,'2026-10-05','Existing game');
    INSERT INTO dance_slots VALUES(5,1,2,'pair-id','booked'),(5,2,1,'pair-id','booked');
    INSERT INTO dance_players VALUES(1),(2);
    DROP TABLE dance_attendance;
  `);
  db.prepare("INSERT INTO events VALUES(8,'Calendar event',?,'venue','description','members')").run(
    invalidDate ? "bad-date" : "2026-10-05T18:30:00Z",
  );
  db.exec(`INSERT INTO rsvps VALUES(8,1); PRAGMA user_version=${version};`);
  db.close();
}
const rows = (db: Database.Database) =>
  Object.fromEntries(
    [
      "users",
      "settings",
      "bootstrap",
      "sessions",
      "invitations",
      "password_resets",
      "events",
      "rsvps",
      "dance_games",
      "dance_slots",
      "dance_players",
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
  );

test("startup and status never initialize a missing database or owner secret", () => {
  const f = fixture();
  try {
    assert.throws(() => new DatabaseStorage(f.db, f.setup), /explicit migration/);
    assert.deepEqual(databaseStatus(f.db), {
      exists: false,
      version: null,
      required: 3,
      compatible: false,
    });
    assert.equal(existsSync(f.db), false);
    assert.equal(existsSync(f.setup), false);
    assert.throws(() => migrateDatabase(f.db), /--init/);
    assert.equal(existsSync(f.db), false);
  } finally {
    f.cleanup();
  }
});

test("explicit initialization creates schema only; application startup creates owner setup", () => {
  const f = fixture();
  try {
    assert.deepEqual(migrateDatabase(f.db, { initialize: true }), {
      from: 0,
      to: 3,
      changed: true,
    });
    assert.equal(existsSync(f.setup), false);
    const db = new Database(f.db);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM bootstrap").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM settings").get() as { n: number }).n, 0);
    db.close();
    const store = new DatabaseStorage(f.db, f.setup);
    assert.equal(store.setupRequired(), true);
    assert.equal(existsSync(f.setup), true);
    store.close();
  } finally {
    f.cleanup();
  }
});

for (const version of [0, 1, 2]) {
  test(`explicit legacy v${version} upgrade preserves accounts, security records, events and pairs`, () => {
    const f = fixture();
    try {
      legacy(f.db, version);
      const original = readFileSync(f.db);
      assert.throws(() => new DatabaseStorage(f.db, f.setup), /schema version/);
      assert.deepEqual(readFileSync(f.db), original);
      assert.equal(existsSync(f.setup), false);
      assert.throws(() => migrateDatabase(f.db, { initialize: true }), /Initialization/);
      let db = new Database(f.db);
      const before = rows(db);
      db.close();
      assert.deepEqual(migrateDatabase(f.db), { from: version, to: 3, changed: true });
      db = new Database(f.db);
      assert.deepEqual(rows(db), before);
      assert.deepEqual(db.prepare("SELECT * FROM dance_attendance ORDER BY user_id").all(), [
        { game_id: 5, user_id: 1, attending: 1 },
        { game_id: 5, user_id: 2, attending: 1 },
      ]);
      db.close();
      const after = readFileSync(f.db);
      assert.deepEqual(migrateDatabase(f.db), { from: 3, to: 3, changed: false });
      assert.deepEqual(readFileSync(f.db), after);
      assert.equal(existsSync(f.setup), false);
      const store = new DatabaseStorage(f.db, f.setup);
      assert.equal(store.setupRequired(), false);
      assert.equal(existsSync(f.setup), false);
      store.close();
    } finally {
      f.cleanup();
    }
  });
}

test("failed backfill rolls back DDL, data and schema version together", () => {
  const f = fixture();
  try {
    legacy(f.db, 2, true);
    const original = readFileSync(f.db);
    assert.throws(() => migrateDatabase(f.db));
    const db = new Database(f.db);
    assert.equal(db.pragma("user_version", { simple: true }), 2);
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name='dance_attendance'").get(),
      undefined,
    );
    db.close();
    assert.deepEqual(readFileSync(f.db), original);
    assert.equal(existsSync(f.setup), false);
  } finally {
    f.cleanup();
  }
});

test("future schema, unknown database and damaged v3 schema are rejected without repair", () => {
  for (const kind of ["future", "unknown", "damaged"]) {
    const f = fixture();
    try {
      const db = new Database(f.db);
      if (kind === "unknown") db.exec("CREATE TABLE unrelated(secret TEXT)");
      else {
        db.exec(SCHEMA_V3_SQL);
        db.exec(`PRAGMA user_version=${kind === "future" ? 99 : 3}`);
        if (kind === "damaged") db.exec("DROP TABLE invitations");
      }
      db.close();
      const original = readFileSync(f.db);
      assert.throws(() => new DatabaseStorage(f.db, f.setup));
      assert.throws(() => migrateDatabase(f.db));
      assert.deepEqual(readFileSync(f.db), original);
      assert.equal(existsSync(f.setup), false);
    } finally {
      f.cleanup();
    }
  }
});

test("migration CLI requires deliberate flags and read-only status reports missing schema", () => {
  const f = fixture();
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "server/migrate.ts", ...args], {
      env: { ...process.env, DB_PATH: f.db, SETUP_PATH: f.setup },
      encoding: "utf8",
    });
  try {
    assert.equal(run().status, 1);
    assert.equal(run("--apply").status, 1);
    assert.equal(run("--status", "--apply").status, 1);
    assert.equal(run("--status").status, 2);
    assert.equal(existsSync(f.db), false);
    assert.equal(run("--apply", "--init").status, 0);
    assert.equal(run("--status").status, 0);
    assert.equal(run("--apply", "--backup-confirmed").status, 0);
    assert.equal(run("--apply", "--init").status, 1);
    assert.equal(existsSync(f.setup), false);
  } finally {
    f.cleanup();
  }
});

test("concurrent migration commands recheck version under the transaction lock", async () => {
  const f = fixture();
  try {
    legacy(f.db);
    const run = () =>
      new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "server/migrate.ts", "--apply", "--backup-confirmed"],
          {
            env: { ...process.env, DB_PATH: f.db },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
      });
    const results = await Promise.all([run(), run()]);
    assert.ok(results.every((result) => result.code === 0));
    assert.deepEqual(results.map((result) => JSON.parse(result.output).changed).sort(), [
      false,
      true,
    ]);
    assert.equal(databaseStatus(f.db).compatible, true);
  } finally {
    f.cleanup();
  }
});

test("invalid foreign keys and public storage locations are rejected", () => {
  const f = fixture();
  try {
    legacy(f.db);
    const db = new Database(f.db);
    db.pragma("foreign_keys=OFF");
    db.exec("INSERT INTO rsvps VALUES(8,999)");
    db.close();
    const original = readFileSync(f.db);
    assert.throws(() => migrateDatabase(f.db), /integrity/);
    assert.deepEqual(readFileSync(f.db), original);
    const publicPath = path.join(f.dir, "dist", "club.sqlite");
    assert.throws(() => migrateDatabase(publicPath, { initialize: true }), /Private storage/);
    assert.equal(existsSync(publicPath), false);
  } finally {
    f.cleanup();
  }
});
