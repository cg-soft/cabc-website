import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { openDatabase, addMember } from "./db.mjs";
import { createApp } from "./server.mjs";
import { migrateLoginHistory } from "./migrate.mjs";

const password = "Login-history-fixture-2026";
async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-logins-"));
  const filename = path.join(directory, "club.sqlite");
  const db = openDatabase(filename, true);
  addMember(db, { name: "Alex Chen", email: "alex@example.test", password }, "admin");
  addMember(db, { name: "Jamie Wu", email: "jamie@example.test", password });
  addMember(db, { name: "-Guest-", email: "guest@example.test", password });
  const server = createApp({ db }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = (email, pw = password, rememberDevice = false) => fetch(`${base}/login`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw, rememberDevice }) });
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { db, filename, login };
}
const rows = db => db.prepare("SELECT * FROM login_history ORDER BY id").all();

test("successful logins are recorded with a timestamp; failures are not", async t => {
  const f = await fixture(t);
  assert.equal((await f.login("alex@example.test", "wrong")).status, 401);
  assert.equal((await f.login("nobody@example.test")).status, 401);
  assert.equal((await f.login("guest@example.test")).status, 401);
  assert.equal(rows(f.db).length, 0);
  assert.equal((await f.login("alex@example.test")).status, 200);
  assert.equal((await f.login("JAMIE@example.test", password, true)).status, 200);
  const history = rows(f.db);
  assert.deepEqual(history.map(r => [r.member_name, r.member_email, r.remembered]),
    [["Alex Chen", "alex@example.test", 0], ["Jamie Wu", "jamie@example.test", 1]]);
  for (const r of history) assert.ok(Math.abs(Date.parse(r.created_at) - Date.now()) < 60000);
  assert.equal(JSON.stringify(history).includes(password), false);
});

test("migration is additive and repeatable; sign-in works before it", async t => {
  const f = await fixture(t);
  f.db.exec("DROP TABLE login_history");
  assert.equal((await f.login("alex@example.test")).status, 200);
  const result = migrateLoginHistory(f.filename);
  assert.equal(result.applied, true); assert.deepEqual(result.before, result.after);
  assert.equal(migrateLoginHistory(f.filename).applied, false);
  assert.equal(f.db.prepare("PRAGMA user_version").get().user_version, 1);
  assert.equal((await f.login("alex@example.test")).status, 200);
  assert.equal(rows(f.db).length, 1);
});

test("manage.mjs login-history lists recent sign-ins read-only", async t => {
  const f = await fixture(t);
  await f.login("alex@example.test"); await f.login("jamie@example.test", password, true);
  f.db.prepare("INSERT INTO login_history(created_at,member_id,member_name,member_email,remembered) VALUES('2020-01-01T00:00:00.000Z',1,'Old Entry','old@example.test',0)").run();
  const run = (...args) => spawnSync(process.execPath, ["manage.mjs", "login-history", ...args],
    { env: { ...process.env, DB_PATH: f.filename }, encoding: "utf8" });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /last 30 days.*: 2\n/);
  assert.match(result.stdout, /Jamie Wu <jamie@example.test>  \[remembered device\]/);
  assert.match(result.stdout, /Alex Chen <alex@example.test>\n/);
  assert.doesNotMatch(result.stdout, /Old Entry/);
  assert.match(result.stdout, /Distinct members: 2/);
  assert.match(run("99999").stdout, /Old Entry/);
  assert.notEqual(run("abc").status, 0);
  assert.equal(rows(f.db).length, 3);
});
