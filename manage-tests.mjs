import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, openDatabase, addMember, passwordMatches } from "./db.mjs";
import { createApp } from "./server.mjs";

// Simulate TTY capability only in the child test process; feed answers after prompts.
function run(filename, command, answers = [], interactive = true) {
  return new Promise((resolve, reject) => {
    const args = interactive
      ? ["--import", "data:text/javascript,Object.defineProperty(process.stdin,'isTTY',{value:true})"]
      : [];
    const child = spawn(process.execPath, [...args, "manage.mjs", command], {
      cwd: ROOT, env: { ...process.env, DB_PATH: filename },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "", next = 0;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Management command timed out")); }, 10000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.stdout.on("data", data => {
      output += data;
      if (/(Email|Name): /.test(String(data)) && next < answers.length)
        child.stdin.write(answers[next++] + "\n");
    });
    child.stderr.on("data", data => { output += data; });
    child.on("close", code => { clearTimeout(timer); resolve({ code, output }); });
    if (!interactive) child.stdin.end();
  });
}

test("operator promotion command", async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cabc-manage-"));
  const filename = path.join(directory, "club.sqlite");
  let db, server;
  const password = "Fictional-management-test-12345";
  try {
    await t.test("missing database is not initialized", async () => {
      const result = await run(filename, "promote");
      assert.equal(result.code, 1);
      assert.match(result.output, /not initialized/);
      assert.equal(existsSync(filename), false);
    });
    db = openDatabase(filename, true);
    const owner = addMember(db, { name: "Owner", email: "owner@example.test", password }, "admin");
    const member = addMember(db, { name: "Member", email: "member@example.test", password });
    db.exec("INSERT INTO games(id,date,time,name) VALUES(1,'2098-10-23','11:30','Test game')");
    db.prepare("INSERT INTO entries VALUES(1,?,?)").run(owner, member);
    db.prepare("INSERT INTO entries VALUES(1,?,?)").run(member, owner);
    db.prepare("INSERT INTO sessions VALUES('fixture-session',?,?)").run(member, Date.now() + 3600000);
    const snapshot = () => Object.fromEntries(
      ["members", "games", "entries", "sessions", "metadata"]
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
    );
    const before = snapshot();
    await t.test("noninteractive invocation is rejected", async () => {
      const result = await run(filename, "promote", [], false);
      assert.equal(result.code, 1);
      assert.match(result.output, /interactive terminal/);
      assert.deepEqual(snapshot(), before);
    });
    await t.test("unknown and blank emails cannot create accounts", async () => {
      for (const email of ["absent@example.test", "", "' OR 1=1 --"]) {
        const result = await run(filename, "promote", [email]);
        assert.equal(result.code, 1);
        assert.match(result.output, /Account not found/);
        assert.deepEqual(snapshot(), before);
      }
    });
    await t.test("promotion changes only the role and normalizes the email", async () => {
      const result = await run(filename, "promote", ["  MEMBER@EXAMPLE.TEST  "]);
      assert.equal(result.code, 0);
      assert.match(result.output, /Administrator access granted to Member/);
      assert.doesNotMatch(result.output, /Generated password|Fictional-management/);
      const expected = structuredClone(before);
      expected.members.find(row => row.id === member).role = "admin";
      // SQLite rows have null prototypes; compare serialized values across the clone.
      assert.equal(JSON.stringify(snapshot()), JSON.stringify(expected));
      assert.ok(passwordMatches(password, db.prepare("SELECT password FROM members WHERE id=?").get(member).password));
    });
    await t.test("already-admin promotion is an unchanged success", async () => {
      const current = snapshot();
      const result = await run(filename, "promote", ["member@example.test"]);
      assert.equal(result.code, 0);
      assert.match(result.output, /already an administrator/);
      assert.deepEqual(snapshot(), current);
    });
    await t.test("promotion survives database reopening and grants admin API access", async () => {
      db.close(); db = openDatabase(filename);
      server = createApp({ db }); server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${server.address().port}`;
      const login = await fetch(base + "/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "member@example.test", password })
      });
      assert.equal(login.status, 200);
      const session = await login.json();
      assert.equal(session.member.role, "admin");
      const result = await fetch(base + "/api/games", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ date: "2098-10-24", time: "11:30", name: "Admin access test" })
      });
      assert.equal(result.status, 201);
    });
    await t.test("existing reset-password command still resets and revokes sessions", async () => {
      const result = await run(filename, "reset-password", ["member@example.test"]);
      assert.equal(result.code, 0);
      const replacement = /Generated password .*: (\S+)/.exec(result.output)?.[1];
      assert.ok(replacement);
      const row = db.prepare("SELECT * FROM members WHERE id=?").get(member);
      assert.ok(passwordMatches(replacement, row.password));
      assert.equal(row.role, "admin");
      assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE member_id=?").get(member).n, 0);
      assert.deepEqual(snapshot().entries, before.entries);
    });
    await t.test("init still creates an administrator only in a fresh database", async () => {
      const fresh = path.join(directory, "fresh.sqlite");
      const result = await run(fresh, "init", ["fresh@example.test", "Fresh Owner"]);
      assert.equal(result.code, 0);
      const freshDb = openDatabase(fresh);
      try { assert.equal(freshDb.prepare("SELECT role FROM members").get().role, "admin"); }
      finally { freshDb.close(); }
      const repeat = await run(fresh, "init", ["another@example.test", "Another Owner"]);
      assert.equal(repeat.code, 1);
      assert.match(repeat.output, /will not replace accounts/);
    });
    await t.test("usage lists promote", async () => {
      const result = await run(filename, "unknown");
      assert.equal(result.code, 1);
      assert.match(result.output, /Usage:.*promote/);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
