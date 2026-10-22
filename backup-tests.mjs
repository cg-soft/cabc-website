import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, lstatSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openDatabase, addMember } from "./db.mjs";
import { configuration, setup, runBackup, verifyBackup, restoreCopy, cronLine } from "./backup.mjs";

test("encrypted backups and recovery", async t => {
  process.umask(0o077);
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-backup-tests-"));
  const config = configuration({ DB_PATH: path.join(directory, "club.sqlite"), BACKUP_KEEP: "12" });
  let db;
  try {
    db = openDatabase(config.database, true);
    addMember(db, { name: "Backup Test", email: "backup@example.test", password: "Isolated-backup-test-12345" }, "admin");
    addMember(db, { name: "Backup Partner", email: "partner@example.test", password: "Isolated-partner-test-12345" });
    let artifact;
    await t.test("setup creates private key once without modifying accounts", () => {
      setup(config);
      const original = readFileSync(config.keyFile);
      setup(config);
      assert.deepEqual(readFileSync(config.keyFile), original);
      assert.equal(lstatSync(config.keyFile).mode & 0o777, 0o600);
      assert.equal(lstatSync(config.directory).mode & 0o777, 0o700);
      assert.equal(db.prepare("SELECT count(*) AS n FROM members").get().n, 2);
    });
    await t.test("online backup includes committed WAL records, excludes uncommitted writes", async () => {
      db.prepare("INSERT INTO games(id,date,time) VALUES(1,'2098-11-01','11:30')").run();
      db.exec("INSERT INTO entries VALUES(1,1,2); INSERT INTO entries VALUES(1,2,1);");
      assert.ok(existsSync(config.database + "-wal"));
      db.exec("BEGIN IMMEDIATE; INSERT INTO games(id,date,time) VALUES(2,'2098-11-02','11:30')");
      try { artifact = (await runBackup(config)).file; }
      finally { db.exec("ROLLBACK"); }
      assert.equal(lstatSync(artifact).mode & 0o777, 0o600);
      const bytes = readFileSync(artifact);
      assert.equal(bytes.subarray(0, 8).toString(), "CABCBAK1");
      assert.ok(!bytes.includes(Buffer.from("backup@example.test")));
      assert.ok(!bytes.includes(Buffer.from("SQLite format 3")));
      await verifyBackup(artifact, config);
      const recovered = path.join(directory, "recovery-check.sqlite");
      await restoreCopy(artifact, recovered, config);
      const restored = new DatabaseSync(recovered, { readOnly: true });
      try {
        assert.equal(restored.prepare("SELECT count(*) AS n FROM members").get().n, 2);
        assert.equal(restored.prepare("SELECT count(*) AS n FROM games").get().n, 1);
        assert.equal(restored.prepare("SELECT count(*) AS n FROM entries").get().n, 2);
        assert.equal(restored.prepare("SELECT partner_id FROM entries WHERE member_id=1").get().partner_id, 2);
      } finally { restored.close(); }
      assert.equal(db.prepare("SELECT count(*) AS n FROM games").get().n, 1);
    });
    await t.test("corruption and wrong keys fail, with no recovery file published", async () => {
      const altered = path.join(directory, "altered.enc");
      const bytes = Buffer.from(readFileSync(artifact));
      bytes[bytes.length - 30] ^= 1;
      writeFileSync(altered, bytes, { mode: 0o600 });
      await assert.rejects(verifyBackup(altered, config), /authentication failed/);
      const output = path.join(directory, "must-not-exist.sqlite");
      await assert.rejects(restoreCopy(altered, output, config), /authentication failed/);
      assert.equal(existsSync(output), false);
      const wrong = path.join(directory, "wrong-key.hex");
      writeFileSync(wrong, "00".repeat(32), { mode: 0o600 });
      await assert.rejects(verifyBackup(artifact, { ...config, keyFile: wrong }), /authentication failed/);
      assert.ok(!readdirSync(config.directory).some(name => name.startsWith(".cabc-work-")));
    });
    await t.test("restore refuses live, existing and symlink targets", async () => {
      await assert.rejects(restoreCopy(artifact, config.database, config), /new private filename/);
      await assert.rejects(restoreCopy(artifact, path.join(directory, "recovery-check.sqlite"), config), /new private filename/);
      const link = path.join(directory, "link.sqlite");
      symlinkSync(config.database, link);
      await assert.rejects(restoreCopy(artifact, link, config), /symlinks/);
    });
    await t.test("existing locks prevent overlapping backup runs", async () => {
      const lock = path.join(config.directory, ".backup.lock");
      mkdirSync(lock, { mode: 0o700 });
      await assert.rejects(runBackup(config), /Backup lock exists/);
      assert.equal(existsSync(lock), true);
      rmSync(lock, { recursive: true });
    });
    await t.test("retention keeps exactly 12 successful snapshots and leaves unrelated files", async () => {
      const unrelated = path.join(config.directory, "keep-me.txt");
      writeFileSync(unrelated, "not managed by backup", { mode: 0o600 });
      for (let i = 0; i < 13; i++) await runBackup(config);
      const copies = readdirSync(config.directory).filter(name => name.endsWith(".sqlite.enc"));
      assert.equal(copies.length, 12);
      assert.equal(existsSync(unrelated), true);
      assert.equal(existsSync(artifact), false);
      artifact = path.join(config.directory, copies.sort().at(-1));
      assert.ok(!readdirSync(config.directory).some(name => name.startsWith(".cabc-work-")));
    });
    await t.test("missing key does not prune backups or silently replace the recovery key", async () => {
      const before = readdirSync(config.directory).sort(), key = readFileSync(config.keyFile);
      unlinkSync(config.keyFile);
      await assert.rejects(runBackup(config), /key is missing/);
      assert.throws(() => setup(config), /Recover the original key/);
      assert.deepEqual(readdirSync(config.directory).sort(), before);
      writeFileSync(config.keyFile, key, { mode: 0o600 });
    });
    await t.test("unsafe paths, public destinations and invalid retention are refused", () => {
      assert.throws(() => configuration({ DB_PATH: config.database, BACKUP_DIR: path.join(directory, "public_html/backups") }), /document roots/);
      assert.throws(() => configuration({ DB_PATH: config.database, BACKUP_KEEP: "0" }), /BACKUP_KEEP/);
      assert.throws(() => configuration({ DB_PATH: config.database, BACKUP_DIR: directory }), /outside the backup directory/);
    });
    await t.test("a failed snapshot does not prune or publish backups", async () => {
      const before = readdirSync(config.directory).sort();
      db.prepare("INSERT INTO metadata VALUES('preview','1')").run();
      try { await assert.rejects(runBackup(config), /fictional preview/); }
      finally { db.prepare("DELETE FROM metadata WHERE key='preview'").run(); }
      assert.deepEqual(readdirSync(config.directory).sort(), before);
    });
    await t.test("missing live database never creates a replacement", async () => {
      const missing = path.join(directory, "missing.sqlite");
      await assert.rejects(runBackup({ ...config, database: missing }), /not found/);
      assert.equal(existsSync(missing), false);
    });
    await t.test("standalone setup, run, verify and cron work across separate processes", () => {
      const env = { ...process.env, DB_PATH: config.database, BACKUP_DIR: config.directory,
        BACKUP_KEY_PATH: config.keyFile, BACKUP_KEEP: "12" };
      for (const args of [["setup"], ["run"], ["verify", artifact], ["cron"]]) {
        const result = spawnSync(process.execPath, ["backup.mjs", ...args], { env, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.ok(result.stdout.trim().length > 0);
      }
      const invalid = spawnSync(process.execPath, ["backup.mjs", "verify", "missing.enc"], { env, encoding: "utf8" });
      assert.equal(invalid.status, 1);
    });
    await t.test("cron entry is weekly Sunday 03:00 with explicit database, key and retention", () => {
      const line = cronLine(config);
      assert.ok(line.startsWith("0 3 * * 0 "));
      assert.ok(line.includes(`DB_PATH='${config.database}'`));
      assert.ok(line.includes("BACKUP_KEEP='12'"));
      assert.ok(line.includes(process.execPath));
      assert.ok(!line.includes(readFileSync(config.keyFile, "utf8").trim()));
    });
    await t.test("generated cron command runs with a minimal environment", () => {
      const command = cronLine(config).slice("0 3 * * 0 ".length);
      const result = spawnSync("/bin/sh", ["-c", command], {
        cwd: tmpdir(), env: { PATH: "/usr/bin:/bin" }, encoding: "utf8"
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /CABC backup verified/);
      assert.equal(readdirSync(config.directory).filter(name => name.endsWith(".sqlite.enc")).length, 12);
    });
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
