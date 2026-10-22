import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, addMember, ROOT } from "./db.mjs";
import { migrateGameNames } from "./migrate.mjs";
import { createApp } from "./server.mjs";

test("explicit game-name migration", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-migration-"));
  const file = path.join(directory, "legacy.sqlite");
  let db;
  try {
    await t.test("missing databases are never created", () => {
      assert.throws(() => migrateGameNames(file), /not found/);
      assert.equal(existsSync(file), false);
    });
    db = new DatabaseSync(file);
    const legacy = readFileSync(path.join(ROOT, "schema.sql"), "utf8").replace(",\n  name TEXT NOT NULL DEFAULT ''", "");
    db.exec(legacy);
    db.exec("INSERT INTO members VALUES(1,'Legacy Admin','legacy@example.test','unchanged-hash','admin'); INSERT INTO members VALUES(2,'Partner','partner@example.test','unchanged-hash','member'); INSERT INTO games VALUES(1,'2098-12-01','11:30'); INSERT INTO entries VALUES(1,1,2); INSERT INTO entries VALUES(1,2,1); INSERT INTO sessions VALUES('unchanged-token-hash',1,9999999999999);");
    const before = Object.fromEntries(["members", "games", "entries", "sessions"].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
    db.close(); db = undefined;
    await t.test("startup fails clearly until migration is explicitly applied", () => {
      assert.throws(() => openDatabase(file), /node migrate.mjs game-names/);
    });
    await t.test("migration only adds the optional column and preserves existing records", () => {
      const result = migrateGameNames(file);
      assert.equal(result.applied, true);
      assert.deepEqual(result.before, result.after);
      db = openDatabase(file);
      for (const table of ["members", "entries", "sessions"])
        assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[table]);
      assert.deepEqual(db.prepare("SELECT id,date,time FROM games").all(), before.games);
      assert.equal(db.prepare("SELECT name FROM games").get().name, "");
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
      db.prepare("UPDATE games SET name='Preserved name' WHERE id=1").run();
      db.close(); db = undefined;
    });
    await t.test("repeating migration is safe and leaves names intact", () => {
      assert.equal(migrateGameNames(file).applied, false);
      db = openDatabase(file);
      assert.equal(db.prepare("SELECT name FROM games").get().name, "Preserved name");
      assert.equal(db.prepare("SELECT count(*) AS n FROM metadata WHERE key='migration:001-game-names'").get().n, 1);
      db.close(); db = undefined;
    });
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("named games and upcoming-month selection", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-calendar-"));
  let db, server;
  try {
    db = openDatabase(path.join(directory, "club.sqlite"), true);
    db.prepare("INSERT INTO metadata VALUES('preview','1')").run();
    const password = "Calendar-tests-only-12345";
    const adminId = addMember(db, { name: "Admin", email: "admin@example.test", password }, "admin");
    const memberId = addMember(db, { name: "Member", email: "member@example.test", password });
    server = createApp({ db, preview: true, previewToday: "2026-10-22" });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    async function req(route, method = "GET", body, token) {
      const res = await fetch(base + route, { method, headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, body: await res.json() };
    }
    const admin = (await req("/api/login", "POST", { email: "admin@example.test", password })).body.token;
    const member = (await req("/api/login", "POST", { email: "member@example.test", password })).body.token;
    const calendar = async query => (await req("/api/calendar" + (query || ""), "GET", undefined, member)).body;
    await t.test("no future schedule returns one global empty state, even when past dates exist", async () => {
      db.prepare("INSERT INTO games(date,time) VALUES('2026-10-01','11:30')").run();
      const result = await calendar();
      assert.equal(result.month, null); assert.deepEqual(result.months, []);
      assert.deepEqual(result.games, []);
    });
    let december;
    await t.test("first available month skips the current past-only month and all empty gaps", async () => {
      const response = await req("/api/games", "POST", { date: "2026-12-07", time: "11:30", name: "  Holiday Duplicate  " }, admin);
      assert.equal(response.status, 201); december = response.body.id;
      await req("/api/games", "POST", { date: "2027-03-01", time: "11:30" }, admin);
      await req("/api/games", "POST", { date: "2035-09-03", time: "11:30", name: "Far future" }, admin);
      const result = await calendar();
      assert.equal(result.month, "2026-12");
      assert.deepEqual(result.months, ["2026-12", "2027-03", "2035-09"]);
      assert.equal(result.games[0].name, "Holiday Duplicate");
      assert.deepEqual(result.entries, []); // A game with no registrations still counts.
      assert.equal((await calendar("?month=2027-01")).month, "2026-12");
      assert.equal((await calendar("?month=2027-03")).month, "2027-03");
      assert.equal((await calendar("?month=2026-10")).month, "2026-12");
    });
    await t.test("today counts as upcoming and becomes the initial month", async () => {
      assert.equal((await req("/api/games", "POST", { date: "2026-10-22", time: "11:30", name: "Today" }, admin)).status, 201);
      const result = await calendar();
      assert.equal(result.month, "2026-10");
      assert.ok(result.games.some(game => game.date === "2026-10-22"));
    });
    await t.test("invalid or overlong names are rejected, optional names remain valid", async () => {
      for (const name of ["x".repeat(81), { unsafe: true }, null]) {
        assert.equal((await req("/api/games", "POST", { date: "2027-05-01", time: "11:30", name }, admin)).status, 400);
      }
      assert.equal((await req("/api/games", "POST", { date: "2027-05-01", time: "11:30", name: "   " }, admin)).status, 201);
      assert.equal((await calendar("?month=2027-05")).games[0].name, "");
    });
    await t.test("only admins can rename; names persist without changing partnerships", async () => {
      await req(`/api/games/${december}/entry`, "POST", { partnerId: memberId }, admin);
      const before = db.prepare("SELECT * FROM entries WHERE game_id=? ORDER BY member_id").all(december);
      assert.equal((await req(`/api/games/${december}/name`, "POST", { name: "Not allowed" }, member)).status, 403);
      assert.equal((await req(`/api/games/${december}/name`, "POST", { name: "x".repeat(81) }, admin)).status, 400);
      const literal = '<img src=x onerror="alert(1)"> & Friends';
      assert.equal((await req(`/api/games/${december}/name`, "POST", { name: literal }, admin)).status, 200);
      assert.equal((await calendar("?month=2026-12")).games[0].name, literal);
      assert.deepEqual(db.prepare("SELECT * FROM entries WHERE game_id=? ORDER BY member_id").all(december), before);
      assert.equal(before[0].member_id, adminId);
      assert.equal((await req(`/api/games/${december}/name`, "POST", { name: "" }, admin)).status, 200);
      assert.equal((await calendar("?month=2026-12")).games[0].name, "");
    });
    await t.test("expired requested months fall back and invalid queries remain errors", async () => {
      // Change only the test clock, not stored game records.
      await new Promise(resolve => server.close(resolve)); server = undefined;
      server = createApp({ db, preview: true, previewToday: "2036-01-01" });
      server.listen(0, "127.0.0.1"); await once(server, "listening");
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/calendar?month=2026-12`,
        { headers: { Authorization: `Bearer ${member}` } });
      const result = await response.json();
      assert.equal(result.month, null); assert.deepEqual(result.months, []);
      const invalid = await fetch(`http://127.0.0.1:${server.address().port}/api/calendar?month=invalid`,
        { headers: { Authorization: `Bearer ${member}` } });
      assert.equal(invalid.status, 400);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close(); rmSync(directory, { recursive: true, force: true });
  }
});
