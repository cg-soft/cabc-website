import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync, symlinkSync, truncateSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, addMember, passwordMatches, hashToken, ROOT } from "./db.mjs";
import { createApp } from "./server.mjs";
import { parseCsv, importMembers } from "./import-members.mjs";

const header = "name,email,initial-password\n";
const initial = "CSV-test-password-12345";
test("member CSV parsing", async t => {
  await t.test("UTF-8 BOM, CRLF, quoted commas, quotes and Unicode", () => {
    const rows = parseCsv('\uFEFFname,email,initial-password\r\n"Lee, ""Pat""", Pat@Example.test ,' + initial + '\r\n陳美玲,chen@example.test,' + initial + "\r\n");
    assert.equal(rows[0].name, 'Lee, "Pat"');
    assert.equal(rows[0].email, "pat@example.test");
    assert.equal(rows[1].name, "陳美玲");
    assert.equal(rows[0].line, 2); assert.equal(rows[1].line, 3);
  });
  await t.test("reordered headers, blanks and exact password whitespace", () => {
    const rows = parseCsv('\n INITIAL-PASSWORD , NAME , Email \n\n"  Exact password  ","Pat Jones",pat@example.test\n');
    assert.equal(rows[0].password, "  Exact password  ");
    assert.equal(rows[0].line, 4);
    assert.equal(parseCsv(header + '"Pat\nJones",pat@example.test,' + initial)[0].name, "Pat\nJones");
  });
  await t.test("malformed and ambiguous CSV rejects without echoing fields", () => {
    for (const text of [
      "", header, "name,email,password\nPat,p@example.test," + initial,
      "name,email,initial-password,role\nPat,p@example.test," + initial + ",admin",
      "name,name,initial-password\nPat,p@example.test," + initial,
      header + 'Pat,p@example.test,"' + initial,
      header + '"Pat"junk,p@example.test,' + initial,
      header + 'P"at,p@example.test,' + initial,
      header + 'Pat,p@example.test,' + initial + ',extra',
      header + 'Pat,p@example.test,"secret\npassword-12345"'
    ]) {
      assert.throws(() => parseCsv(text), error => !error.message.includes(initial) && !error.message.includes("secret\npassword"));
    }
  });
  await t.test("validates names/emails/passwords and detects normalized duplicate addresses", () => {
    for (const row of [
      "A,one@example.test," + initial,
      "Pat,not-an-email," + initial,
      "Pat,one@example.test,short",
      "Pat,one@example.test," + "x".repeat(129),
      "Pa\0t,one@example.test," + initial
    ]) assert.throws(() => parseCsv(header + row));
    assert.throws(() => parseCsv(header + `Pat, Same@Example.test ,${initial}\nOther,same@example.test,${initial}`), /first occurrence is on line 2/);
    const huge = header + Array.from({ length: 5001 }, (_, i) => `Person ${i},p${i}@example.test,${initial}`).join("\n");
    assert.throws(() => parseCsv(huge), /5000 member rows/);
  });
});

test("safe member import", async t => {
  process.umask(0o077);
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-import-"));
  const database = path.join(directory, "club.sqlite"), csvPath = path.join(directory, "members.csv");
  const write = text => writeFileSync(csvPath, text, { mode: 0o600 });
  let db, server;
  try {
    db = openDatabase(database, true);
    const adminId = addMember(db, { name: "Existing Admin", email: "admin@example.test", password: "Existing-admin-password-12345" }, "admin");
    const oldId = addMember(db, { name: "Existing Member", email: "existing@example.test", password: "Existing-member-password-12345" });
    db.exec("INSERT INTO games VALUES(1,'2098-11-01','11:30','Unchanged game')");
    db.prepare("INSERT INTO entries VALUES(1,?,?)").run(adminId, oldId);
    db.prepare("INSERT INTO entries VALUES(1,?,?)").run(oldId, adminId);
    const existingToken = "a".repeat(64);
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hashToken(existingToken), oldId, Date.now() + 3600000);
    const before = Object.fromEntries(["members", "games", "entries", "sessions"].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
    await t.test("default dry run validates without changing credentials or records", () => {
      write(header + `New One,one@example.test,${initial}\nNew Two,two@example.test,${initial}\n`);
      const result = importMembers({ csvPath, database });
      assert.equal(result.dryRun, true); assert.equal(result.wouldAdd, 2);
      assert.deepEqual(result.before, result.after);
      for (const table of Object.keys(before))
        assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(), before[table]);
    });
    await t.test("apply creates only members, stores salted hashes and preserves existing data", () => {
      const result = importMembers({ csvPath, database, apply: true });
      assert.equal(result.added, 2); assert.equal(result.after.members, result.before.members + 2);
      const one = db.prepare("SELECT * FROM members WHERE email='one@example.test'").get();
      const two = db.prepare("SELECT * FROM members WHERE email='two@example.test'").get();
      assert.equal(one.role, "member"); assert.equal(two.role, "member");
      assert.ok(passwordMatches(initial, one.password)); assert.ok(passwordMatches(initial, two.password));
      assert.notEqual(one.password, initial); assert.notEqual(one.password, two.password);
      assert.deepEqual(db.prepare("SELECT * FROM members WHERE id IN (?,?) ORDER BY id").all(adminId, oldId), before.members);
      for (const table of ["games", "entries", "sessions"])
        assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(), before[table]);
    });
    await t.test("existing emails reject the entire operation by default", () => {
      write(header + `New Three,three@example.test,${initial}\nChanged, ADMIN@example.test ,${initial}`);
      assert.throws(() => importMembers({ csvPath, database, apply: true }), /email already exists/);
      assert.equal(db.prepare("SELECT id FROM members WHERE email='three@example.test'").get(), undefined);
    });
    await t.test("skip-existing adds only new members and reruns are idempotent", () => {
      const result = importMembers({ csvPath, database, apply: true, skipExisting: true });
      assert.equal(result.added, 1); assert.equal(result.skipped, 1);
      const again = importMembers({ csvPath, database, apply: true, skipExisting: true });
      assert.equal(again.added, 0); assert.equal(again.skipped, 2);
      assert.deepEqual(db.prepare("SELECT * FROM members WHERE id=?").get(adminId), before.members[0]);
      assert.deepEqual(db.prepare("SELECT * FROM sessions ORDER BY 1").all(), before.sessions);
    });
    await t.test("a later invalid row prevents all earlier rows from being imported", () => {
      write(header + `New Four,four@example.test,${initial}\nInvalid,bad-address,${initial}`);
      assert.throws(() => importMembers({ csvPath, database, apply: true }), /valid email/);
      assert.equal(db.prepare("SELECT id FROM members WHERE email='four@example.test'").get(), undefined);
    });
    await t.test("an insertion failure rolls back all inserts", () => {
      write(header + `New Five,five@example.test,${initial}\nFail,fail@example.test,${initial}`);
      // Use a persistent test-only trigger because the importer opens its own connection.
      db.exec("CREATE TRIGGER import_test_failure BEFORE INSERT ON members WHEN NEW.email='fail@example.test' BEGIN SELECT RAISE(ABORT,'test insert failure'); END");
      try {
        assert.throws(() => importMembers({ csvPath, database, apply: true }));
        assert.equal(db.prepare("SELECT count(*) AS n FROM members WHERE email IN ('five@example.test','fail@example.test')").get().n, 0);
      } finally { db.exec("DROP TRIGGER import_test_failure"); }
    });
    await t.test("private file checks, encoding, size limits and missing database are safe", () => {
      write(header + `Good,good@example.test,${initial}`);
      chmodSync(csvPath, 0o644);
      assert.throws(() => importMembers({ csvPath, database }), /permissions to 600/);
      chmodSync(csvPath, 0o600);
      const symlink = path.join(directory, "link.csv"); symlinkSync(csvPath, symlink);
      assert.throws(() => importMembers({ csvPath: symlink, database }), /symlinked/);
      assert.throws(() => importMembers({ csvPath: path.join(ROOT, "examples/members-template.csv"), database }), /outside the application/);
      assert.throws(() => importMembers({ csvPath: path.join(directory, "public_html/members.csv"), database }), /document roots/);
      const missing = path.join(directory, "missing.sqlite");
      assert.throws(() => importMembers({ csvPath, database: missing, apply: true }), /Database not initialized/);
      assert.equal(existsSync(missing), false);
      writeFileSync(csvPath, Buffer.from([0xff, 0xfe, 0xff]));
      assert.throws(() => importMembers({ csvPath, database }), /UTF-8/);
      truncateSync(csvPath, 5 * 1024 * 1024 + 1);
      assert.throws(() => importMembers({ csvPath, database }), /5 MB/);
    });
    await t.test("missing administrators and preview databases refuse credential import", () => {
      write(header + `Good,good@example.test,${initial}`);
      const empty = openDatabase(path.join(directory, "empty.sqlite"), true);
      empty.close();
      assert.throws(() => importMembers({ csvPath, database: path.join(directory, "empty.sqlite") }), /initial administrator/);
      db.exec("INSERT INTO metadata VALUES('preview','1')");
      try { assert.throws(() => importMembers({ csvPath, database, apply: true }), /fictional preview/); }
      finally { db.exec("DELETE FROM metadata WHERE key='preview'"); }
    });
    await t.test("CLI defaults to dry run, redacts errors, and requires explicit apply", () => {
      write(header + `CLI Member,cli@example.test,${initial}`);
      const run = (...args) => spawnSync(process.execPath, ["import-members.mjs", csvPath, ...args],
        { cwd: ROOT, env: { ...process.env, DB_PATH: database }, encoding: "utf8" });
      const dry = run();
      assert.equal(dry.status, 0); assert.match(dry.stdout, /DRY RUN/);
      assert.equal(db.prepare("SELECT id FROM members WHERE email='cli@example.test'").get(), undefined);
      assert.equal(run("--dry-run", "--apply").status, 1);
      assert.equal(run("--unknown").status, 1);
      const applied = run("--apply");
      assert.equal(applied.status, 0); assert.match(applied.stdout, /added 1/);
      assert.ok(!applied.stdout.includes(initial)); assert.ok(!applied.stdout.includes("cli@example.test"));
      write(header + `Malformed,secret-in-email,${initial}`);
      const bad = run("--apply");
      assert.equal(bad.status, 1);
      assert.ok(!bad.stderr.includes(initial)); assert.ok(!bad.stderr.includes("secret-in-email"));
    });
    await t.test("imported users can sign in and change their initial passwords", async () => {
      server = createApp({ db }); server.listen(0, "127.0.0.1"); await once(server, "listening");
      const base = `http://127.0.0.1:${server.address().port}`;
      const post = (route, body, token) => fetch(base + route, { method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body) });
      const response = await post("/api/login", { email: "one@example.test", password: initial });
      assert.equal(response.status, 200);
      const { token, member } = await response.json();
      assert.equal(member.role, "member");
      const next = "Updated-after-import-12345";
      assert.equal((await post("/api/password", { currentPassword: initial, newPassword: next, confirmPassword: next }, token)).status, 200);
      assert.equal((await post("/api/login", { email: "one@example.test", password: initial })).status, 401);
      assert.equal((await post("/api/login", { email: "one@example.test", password: next })).status, 200);
      assert.deepEqual(db.prepare("SELECT * FROM entries ORDER BY 1").all(), before.entries);
    });
    await t.test("imported accounts persist after reopening", async () => {
      await new Promise(resolve => server.close(resolve)); server = undefined;
      db.close(); db = new DatabaseSync(database, { readOnly: true });
      assert.equal(db.prepare("SELECT count(*) AS n FROM members").get().n, 6);
      assert.ok(passwordMatches(initial, db.prepare("SELECT password FROM members WHERE email='two@example.test'").get().password));
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close(); rmSync(directory, { recursive: true, force: true });
  }
});
