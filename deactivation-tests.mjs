import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { DatabaseSync, backup } from "node:sqlite";
import { once } from "node:events";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { ROOT, openDatabase, addMember, hashToken } from "./db.mjs";
import { migrateTeamEvents, migrateMemberStatus } from "./migrate.mjs";
import { importMembers } from "./import-members.mjs";
import { createApp } from "./server.mjs";

function management(file, command, email) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "data:text/javascript,Object.defineProperty(process.stdin,'isTTY',{value:true})", "manage.mjs", command], {
      cwd: ROOT, env: { ...process.env, DB_PATH: file }, stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "", answered = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI timed out")); }, 10000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.stdout.on("data", chunk => {
      output += chunk;
      if (!answered && output.includes("Email: ")) { answered = true; child.stdin.write(email + "\n"); }
    });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("close", code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test("explicit member-status migration", async t => {
  const dir = mkdtempSync(path.join(tmpdir(), "cabc-status-migration-"));
  const file = path.join(dir, "club.sqlite");
  let db;
  try {
    await t.test("missing database is never initialized", () => {
      assert.throws(() => migrateMemberStatus(file), /not found/);
      assert.equal(existsSync(file), false);
    });
    db = new DatabaseSync(file);
    db.exec(readFileSync(path.join(ROOT, "schema.sql"), "utf8"));
    db.exec("INSERT INTO members VALUES(1,'Owner','owner@example.test','old-hash','admin'); INSERT INTO members VALUES(2,'Member','member@example.test','another-hash','member'); INSERT INTO games VALUES(1,'2026-10-26','11:30','Existing game'); INSERT INTO entries VALUES(1,1,2); INSERT INTO entries VALUES(1,2,1); INSERT INTO sessions VALUES('existing-session',2,9999999999999)");
    await t.test("prerequisite team-events migration is explicit", () => {
      assert.throws(() => migrateMemberStatus(file), /team-events first/);
      assert.ok(!db.prepare("PRAGMA table_info(members)").all().some(c => c.name === "active"));
      migrateTeamEvents(file);
    });
    const tables = ["members", "games", "entries", "sessions", "team_members"];
    const before = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
    await t.test("server refuses old status schema without mutating it", () => {
      assert.throws(() => createApp({ db }), /node migrate.mjs member-status/);
      assert.ok(!db.prepare("PRAGMA table_info(members)").all().some(c => c.name === "active"));
    });
    await t.test("migration preserves all rows and credentials and defaults everyone to active", () => {
      const result = migrateMemberStatus(file);
      assert.equal(result.applied, true);
      assert.deepEqual(result.before, result.after);
      for (const table of tables.filter(t => t !== "members"))
        assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[table]);
      assert.deepEqual(db.prepare("SELECT id,name,email,password,role FROM members").all(), before.members);
      for (const row of db.prepare("SELECT active,deactivated_at,deactivated_by FROM members").all()) {
        assert.equal(row.active, 1); assert.equal(row.deactivated_at, null); assert.equal(row.deactivated_by, null);
      }
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    });
    await t.test("repeat migration does not reactivate members or change their audit fields", () => {
      db.exec("UPDATE members SET active=0,deactivated_at='2026-10-24T12:00:00Z',deactivated_by=1 WHERE id=2");
      const current = db.prepare("SELECT * FROM members").all();
      const result = migrateMemberStatus(file);
      assert.equal(result.applied, false);
      assert.deepEqual(db.prepare("SELECT * FROM members").all(), current);
      assert.equal(db.prepare("SELECT count(*) AS n FROM metadata WHERE key='migration:003-member-status'").get().n, 1);
    });
    await t.test("incompatible columns roll back partial additions and metadata", () => {
      const bad = path.join(dir, "bad.sqlite");
      const conn = new DatabaseSync(bad);
      conn.exec(readFileSync(path.join(ROOT, "schema.sql"), "utf8")); conn.close();
      migrateTeamEvents(bad);
      const setup = new DatabaseSync(bad);
      setup.exec("ALTER TABLE members ADD COLUMN deactivated_at INTEGER"); setup.close();
      assert.throws(() => migrateMemberStatus(bad), /manual review/);
      const verify = new DatabaseSync(bad);
      try {
        assert.ok(!verify.prepare("PRAGMA table_info(members)").all().some(c => c.name === "active"));
        assert.equal(verify.prepare("SELECT count(*) AS n FROM metadata WHERE key='migration:003-member-status'").get().n, 0);
      } finally { verify.close(); }
    });
    await t.test("unsupported schema is refused", () => {
      const bad = path.join(dir, "unsupported.sqlite");
      const conn = new DatabaseSync(bad); conn.exec("PRAGMA user_version=2"); conn.close();
      assert.throws(() => migrateMemberStatus(bad), /Unsupported/);
    });
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("safe administrator deactivation", async t => {
  const dir = mkdtempSync(path.join(tmpdir(), "cabc-deactivate-"));
  const file = path.join(dir, "club.sqlite");
  let db, server;
  try {
    db = openDatabase(file, true);
    const password = "Fictional-deactivation-test-12345";
    const ids = [];
    for (let i = 0; i < 7; i++)
      ids.push(addMember(db, { name: `Person ${i}`, email: `person${i}@example.test`, password }, i === 0 ? "admin" : "member"));
    const insertGame = db.prepare("INSERT INTO games(id,date,time,name,event_type) VALUES(?,?,'11:30',?,?)");
    // Yesterday is still in the currently displayed month, so names must remain readable.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const offset = n => new Date(new Date(today + "T12:00:00Z").valueOf() + n * 86400000).toISOString().slice(0, 10);
    insertGame.run(1, offset(-1), "Historical team", "teams");
    insertGame.run(2, today, "Today team", "teams");
    insertGame.run(3, offset(30), "Future pair", "pairs");
    insertGame.run(4, offset(60), "Future single", "pairs");
    insertGame.run(5, offset(61), "Stale-review date", "pairs");
    const put = db.prepare("INSERT INTO entries VALUES(?,?,?)");
    for (const game of [1, 2]) {
      for (const [a, b] of [[1, 2], [2, 1], [3, 4], [4, 3]]) put.run(game, ids[a], ids[b]);
      for (const person of [1, 2, 3, 4])
        db.prepare("INSERT INTO team_members VALUES(?,?,?)").run(game, ids[person], `team-${game}`);
    }
    put.run(3, ids[1], ids[2]); put.run(3, ids[2], ids[1]); put.run(4, ids[1], null);
    server = createApp({ db }); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const req = async (route, method = "GET", body, token) => {
      const response = await fetch(base + route, { method, headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }, body: body !== undefined ? JSON.stringify(body) : undefined });
      return { status: response.status, body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text() };
    };
    const login = async i => (await req("/login", "POST", { email: `person${i}@example.test`, password })).body.token;
    const tokens = [];
    for (let i = 0; i < ids.length; i++) tokens.push(await login(i));
    const secondToken = await login(1);
    const pathFor = id => `/members/${id}/deactivate`;
    const review = (id, token = tokens[0]) => req(pathFor(id), "GET", undefined, token);
    const apply = (id, revision, token = tokens[0]) => req(pathFor(id), "POST", { confirm: true, revision }, token);
    const snapshot = () => JSON.stringify(Object.fromEntries(["members", "entries", "team_members", "sessions", "games"].map(table =>
      [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
    let initialPlan, finalPlan;
    await t.test("only admins can list, review or deactivate; no passwords or hashes are returned", async () => {
      const before = snapshot();
      for (const token of [undefined, tokens[1]]) {
        assert.equal((await req("/members/manage", "GET", undefined, token)).status, token ? 403 : 401);
        assert.equal((await req(pathFor(ids[1]), "GET", undefined, token)).status, token ? 403 : 401);
        assert.equal((await req(pathFor(ids[1]), "POST", { confirm: true, revision: "0".repeat(64) }, token)).status, token ? 403 : 401);
      }
      assert.equal((await req(pathFor(ids[1]))).status, 401);
      const list = await req("/members/manage", "GET", undefined, tokens[0]);
      assert.equal(list.status, 200);
      assert.equal(list.body.members.length, ids.length);
      assert.doesNotMatch(JSON.stringify(list.body), /password|deactivated_by|deactivated_at|token|salt/);
      assert.equal(snapshot(), before);
    });
    await t.test("review counts today/future registrations and teams without changes", async () => {
      const before = snapshot();
      const response = await review(ids[1]); assert.equal(response.status, 200);
      initialPlan = response.body;
      assert.equal(initialPlan.registrationCount, 3);
      assert.equal(initialPlan.teamCount, 1);
      assert.deepEqual(initialPlan.games.map(g => g.id), [2, 3, 4]);
      assert.equal(initialPlan.member.name, "Person 1");
      assert.match(initialPlan.revision, /^[a-f0-9]{64}$/);
      assert.equal(snapshot(), before);
    });
    await t.test("last active administrator and missing targets are protected", async () => {
      const before = snapshot();
      const plan = (await review(ids[0])).body;
      assert.equal(plan.canDeactivate, false);
      assert.equal((await apply(ids[0], plan.revision)).status, 409);
      assert.equal((await review(99999)).status, 404);
      assert.equal((await req("/members/999999999999999999999/deactivate", "GET", undefined, tokens[0])).status, 400);
      assert.throws(() => db.prepare("UPDATE members SET active=0 WHERE id=?").run(ids[0]), /last active/);
      assert.throws(() => db.prepare("UPDATE members SET role='member' WHERE id=?").run(ids[0]), /last active/);
      assert.throws(() => db.prepare("DELETE FROM members WHERE id=?").run(ids[0]), /last active/);
      assert.equal(snapshot(), before);
    });
    await t.test("confirmation and matching reviewed target are required", async () => {
      const before = snapshot();
      for (const body of [{}, { confirm: false, revision: initialPlan.revision }, { confirm: true }, { confirm: true, revision: [] }])
        assert.equal((await req(pathFor(ids[1]), "POST", body, tokens[0])).status, 400);
      assert.equal((await apply(ids[5], initialPlan.revision)).status, 409);
      assert.equal(snapshot(), before);
    });
    await t.test("new registrations invalidate the review before anything is changed", async () => {
      put.run(5, ids[1], null);
      const before = snapshot();
      assert.equal((await apply(ids[1], initialPlan.revision)).status, 409);
      assert.equal(snapshot(), before);
      finalPlan = (await review(ids[1])).body;
      assert.equal(finalPlan.registrationCount, 4);
    });
    await t.test("failed deactivation rolls back removed registrations, teams and sessions", async () => {
      db.exec(`CREATE TRIGGER fail_deactivation_test BEFORE UPDATE OF active ON members WHEN NEW.id=${ids[1]} BEGIN SELECT RAISE(ABORT,'fixture failure'); END`);
      const before = snapshot();
      try { assert.equal((await apply(ids[1], finalPlan.revision)).status, 500); assert.equal(snapshot(), before); }
      finally { db.exec("DROP TRIGGER fail_deactivation_test"); }
    });
    const historicalEntries = db.prepare("SELECT * FROM entries WHERE game_id=1 ORDER BY member_id").all();
    const historicalTeams = db.prepare("SELECT * FROM team_members WHERE game_id=1 ORDER BY member_id").all();
    const accountBefore = db.prepare("SELECT id,name,email,password,role FROM members WHERE id=?").get(ids[1]);
    await t.test("deactivation cancels future games, dissolves teams and preserves history and account", async () => {
      const result = await apply(ids[1], finalPlan.revision);
      assert.equal(result.status, 200); assert.equal(result.body.registrationCount, 4); assert.equal(result.body.teamCount, 1);
      assert.equal(db.prepare("SELECT active FROM members WHERE id=?").get(ids[1]).active, 0);
      const audit = db.prepare("SELECT deactivated_at,deactivated_by FROM members WHERE id=?").get(ids[1]);
      assert.ok(!Number.isNaN(Date.parse(audit.deactivated_at))); assert.equal(audit.deactivated_by, ids[0]);
      assert.deepEqual(db.prepare("SELECT id,name,email,password,role FROM members WHERE id=?").get(ids[1]), accountBefore);
      assert.deepEqual(db.prepare("SELECT * FROM entries WHERE game_id=1 ORDER BY member_id").all(), historicalEntries);
      assert.deepEqual(db.prepare("SELECT * FROM team_members WHERE game_id=1 ORDER BY member_id").all(), historicalTeams);
      assert.equal(db.prepare("SELECT count(*) AS n FROM entries WHERE member_id=? AND game_id<>1").get(ids[1]).n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM team_members WHERE game_id=2").get().n, 0);
      for (const game of [2, 3]) assert.equal(db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(game, ids[2]).partner_id, null);
      assert.equal(db.prepare("SELECT partner_id FROM entries WHERE game_id=2 AND member_id=?").get(ids[3]).partner_id, ids[4]);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE member_id=?").get(ids[1]).n, 0);
    });
    await t.test("all sessions and login/password/registration/export access are blocked", async () => {
      for (const token of [tokens[1], secondToken]) {
        assert.equal((await req("/calendar", "GET", undefined, token)).status, 401);
        assert.equal((await req("/calendar/export.ics", "GET", undefined, token)).status, 401);
        assert.equal((await req("/games/2/entry", "POST", { partnerId: null }, token)).status, 401);
        assert.equal((await req("/password", "POST", {}, token)).status, 401);
      }
      const result = await req("/login", "POST", { email: "person1@example.test", password });
      assert.equal(result.status, 401);
      assert.equal(result.body.error, "Email or password is incorrect.");
      const calendar = (await req("/calendar", "GET", undefined, tokens[0])).body;
      assert.equal(calendar.members.find(m => m.id === ids[1]).active, 0);
      assert.equal(calendar.members.find(m => m.id === ids[1]).name, "Person 1");
      assert.doesNotMatch(JSON.stringify(calendar), /example\.test|password|deactivated_by/);
      assert.equal((await req("/games/2/entry", "POST", { partnerId: ids[1] }, tokens[5])).status, 409);
    });
    await t.test("inactive members cannot receive new sessions or registrations via old-version SQL", () => {
      assert.throws(() => db.prepare("INSERT INTO sessions VALUES(?,?,?)").run("old-code-session", ids[1], Date.now() + 100000), /Inactive member/);
      assert.throws(() => db.prepare("INSERT INTO entries VALUES(?,?,?)").run(4, ids[1], null), /Inactive member/);
      assert.throws(() => db.prepare("INSERT INTO entries VALUES(?,?,?)").run(4, ids[5], ids[1]), /Inactive member/);
      assert.throws(() => db.prepare("UPDATE entries SET partner_id=? WHERE game_id=3 AND member_id=?").run(ids[1], ids[2]), /Inactive member/);
      assert.throws(() => db.prepare("UPDATE sessions SET member_id=? WHERE hash=?").run(ids[1], hashToken(tokens[5])), /Inactive member/);
    });
    await t.test("repeated deactivation and migrations are harmless", async () => {
      const before = snapshot();
      assert.equal((await apply(ids[1], finalPlan.revision)).body.alreadyInactive, true);
      assert.equal(migrateMemberStatus(file).applied, false);
      assert.equal(snapshot(), before);
    });
    await t.test("promote/reset commands and CSV import cannot reactivate the account", async () => {
      const before = db.prepare("SELECT * FROM members WHERE id=?").get(ids[1]);
      for (const command of ["promote", "reset-password"]) {
        const result = await management(file, command, "person1@example.test");
        assert.equal(result.code, 1); assert.match(result.output, /inactive/); assert.doesNotMatch(result.output, /Generated password/);
      }
      const csv = path.join(dir, "private.csv");
      writeFileSync(csv, "name,email,initial-password\nRecreated Person,person1@example.test,Replacement-password-12345\n", { mode: 0o600 });
      assert.throws(() => importMembers({ database: file, csvPath: csv, apply: true }), /already exists/);
      assert.equal(importMembers({ database: file, csvPath: csv, apply: true, skipExisting: true }).skipped, 1);
      assert.deepEqual(db.prepare("SELECT * FROM members WHERE id=?").get(ids[1]), before);
    });
    await t.test("backup and reopen preserve inactive status and historical data", async () => {
      const copyFile = path.join(dir, "backup.sqlite"); await backup(db, copyFile);
      const copy = openDatabase(copyFile);
      try {
        assert.equal(copy.prepare("SELECT active FROM members WHERE id=?").get(ids[1]).active, 0);
        assert.deepEqual(copy.prepare("SELECT * FROM team_members WHERE game_id=1 ORDER BY member_id").all(), historicalTeams);
        assert.deepEqual(copy.prepare("PRAGMA foreign_key_check").all(), []);
        assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      } finally { copy.close(); }
    });
    await t.test("two admins racing to deactivate one another leave one active administrator", async () => {
      db.prepare("UPDATE members SET role='admin' WHERE id=?").run(ids[6]);
      const planA = (await review(ids[0], tokens[6])).body;
      const planB = (await review(ids[6], tokens[0])).body;
      const a = apply(ids[0], planA.revision, tokens[6]), b = apply(ids[6], planB.revision, tokens[0]);
      const results = [await a, await b];
      assert.equal(results.filter(r => r.status === 200).length, 1);
      assert.ok(results.some(r => [401, 409].includes(r.status)));
      assert.equal(db.prepare("SELECT count(*) AS n FROM members WHERE active=1 AND role='admin'").get().n, 1);
    });
    await t.test("self-deactivation requires another active admin and returns a sign-out result", async () => {
      const remaining = db.prepare("SELECT id FROM members WHERE active=1 AND role='admin'").get().id;
      const index = ids.indexOf(remaining);
      db.prepare("UPDATE members SET role='admin' WHERE id=?").run(ids[5]);
      const plan = (await review(remaining, tokens[index])).body;
      const result = await apply(remaining, plan.revision, tokens[index]);
      assert.equal(result.status, 200); assert.equal(result.body.self, true);
      assert.equal((await req("/members/manage", "GET", undefined, tokens[index])).status, 401);
      const lastPlan = (await review(ids[5], tokens[5])).body;
      assert.equal(lastPlan.canDeactivate, false);
      assert.equal((await apply(ids[5], lastPlan.revision, tokens[5])).status, 409);
    });
    await t.test("deactivated preview accounts cannot use preview bypass", async () => {
      db.exec("INSERT INTO metadata(key,value) VALUES('preview','1')");
      const demoId = addMember(db, { name: "Inactive Preview", email: "member@preview.invalid", password });
      db.prepare("UPDATE members SET active=0 WHERE id=?").run(demoId);
      const demo = createApp({ db, preview: true }); demo.listen(0, "127.0.0.1"); await once(demo, "listening");
      try {
        const response = await fetch(`http://127.0.0.1:${demo.address().port}/api/preview`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: '{"role":"member"}'
        });
        assert.equal(response.status, 401);
      } finally { demo.closeAllConnections(); await new Promise(resolve => demo.close(resolve)); }
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    db?.close(); rmSync(dir, { recursive: true, force: true });
  }
});
