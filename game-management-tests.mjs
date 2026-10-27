import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { openDatabase, addMember, hashToken } from "./db.mjs";
import { createApp } from "./server.mjs";

test("administrator game editing and deletion", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-game-management-"));
  let db, server;
  try {
    db = openDatabase(path.join(directory, "club.sqlite"), true);
    const password = "Fictional-management-tests-12345";
    const adminId = addMember(db, { name: "QA Admin", email: "admin@example.test", password }, "admin");
    const memberId = addMember(db, { name: "QA Member", email: "member@example.test", password });
    const thirdId = addMember(db, { name: "QA Three", email: "three@example.test", password });
    const fourthId = addMember(db, { name: "QA Four", email: "four@example.test", password });
    const guestId = addMember(db, { name: "-Guest-", email: "guest@example.test", password });
    db.prepare("INSERT INTO metadata VALUES('preview','1')").run();
    server = createApp({ db, preview: true, previewToday: "2026-10-24" });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    async function req(route, method = "GET", body, token) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() };
    }
    const admin = (await req("/api/login", "POST", { email: "admin@example.test", password })).body.token;
    const member = (await req("/api/login", "POST", { email: "member@example.test", password })).body.token;
    const create = (date, type = "pairs") => Number(db.prepare("INSERT INTO games(date,time,name,event_type) VALUES(?,'11:30','QA Game',?)").run(date, type).lastInsertRowid);
    const route = id => `/api/games/${id}/manage`;
    const plan = async id => (await req(route(id), "GET", undefined, admin)).body;
    const rows = table => db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all();
    const snapshot = () => Object.fromEntries(["games", "entries", "team_members", "members", "sessions"].map(table => [table, rows(table)]));
    const entry = (id, player, partner = null) => db.prepare("INSERT INTO entries VALUES(?,?,?)").run(id, player, partner);
    const patch = async (id, changes = {}, revision) => {
      const current = await plan(id);
      return req(route(id), "PATCH", { name: current.game.name, date: current.game.date, time: current.game.time,
        revision: revision ?? current.revision, ...changes }, admin);
    };
    const remove = async (id, fields = {}) => req(route(id), "DELETE", { revision: (await plan(id)).revision, confirm: true, ...fields }, admin);
    const game = create("2026-10-26", "teams");
    entry(game, adminId, memberId); entry(game, memberId, adminId);
    entry(game, thirdId, guestId); entry(game, fourthId);
    for (const id of [adminId, memberId, thirdId])
      db.prepare("INSERT INTO team_members VALUES(?,?,'qa-team')").run(game, id);
    const other = create("2026-11-02");
    entry(other, memberId, guestId);

    await t.test("management requires an active administrator for every method", async () => {
      for (const method of ["GET", "PATCH", "DELETE"]) {
        const body = method === "GET" ? undefined : {};
        assert.equal((await req(route(game), method, body)).status, 401);
        assert.equal((await req(route(game), method, body, member)).status, 403);
      }
      const token = (await req("/api/login", "POST", { email: "admin@example.test", password })).body.token;
      db.prepare("UPDATE sessions SET expires=0 WHERE hash=?").run(hashToken(token));
      assert.equal((await req(route(game), "GET", undefined, token)).status, 401);
    });
    await t.test("review counts real registrations and teams and exposes no account secrets", async () => {
      const result = await plan(game);
      assert.equal(result.registrationCount, 4); assert.equal(result.teamCount, 1);
      assert.equal(result.game.event_type, "teams");
      assert.match(result.revision, /^[a-f0-9]{64}$/);
      assert.equal("entries" in result, false);
      assert.equal(JSON.stringify(result).includes("password"), false);
    });
    await t.test("editing across months preserves ID, all entries, guest assignments, teams and accounts", async () => {
      const before = snapshot();
      const result = await patch(game, { name: "  Moved <QA> & Friends  ", date: "2027-01-04", time: "18:45" });
      assert.equal(result.status, 200);
      assert.equal(result.body.id, game);
      const saved = db.prepare("SELECT * FROM games WHERE id=?").get(game);
      assert.equal(saved.name, "Moved <QA> & Friends"); assert.equal(saved.date, "2027-01-04");
      assert.equal(saved.time, "18:45"); assert.equal(saved.event_type, "teams");
      for (const table of ["entries", "team_members", "members", "sessions"])
        assert.deepEqual(rows(table), before[table]);
      const calendar = await req("/api/calendar?month=2027-01", "GET", undefined, member);
      assert.equal(calendar.body.games[0].id, game);
      assert.equal(calendar.body.month, "2027-01");
    });
    await t.test("editing retains today as valid and permits clearing the optional name", async () => {
      assert.equal((await patch(game, { name: "   ", date: "2026-10-24" })).status, 200);
      assert.equal(db.prepare("SELECT name FROM games WHERE id=?").get(game).name, "");
    });
    await t.test("invalid dates, times and names never modify any records", async () => {
      for (const changes of [
        { date: "2026-02-30" }, { date: "2026-10-23" }, { date: "2026-2-01" },
        { date: null }, { time: "24:00" }, { time: 1130 }, { time: "9:00" },
        { name: "x".repeat(81) }, { name: null }, { name: {} }
      ]) {
        const before = snapshot();
        assert.equal((await patch(game, changes)).status, 400, JSON.stringify(changes));
        assert.deepEqual(snapshot(), before);
      }
    });
    await t.test("duplicate dates and event-type changes are rejected without breaking teams", async () => {
      const before = snapshot();
      assert.equal((await patch(game, { date: "2026-11-02" })).status, 409);
      assert.equal((await patch(game, { eventType: "pairs" })).status, 400);
      assert.deepEqual(snapshot(), before);
    });
    await t.test("both operations require the reviewed revision and deletion requires strict confirmation", async () => {
      const before = snapshot();
      assert.equal((await req(route(game), "PATCH", { name: "Unsafe", date: "2027-01-04", time: "11:30" }, admin)).status, 409);
      assert.equal((await remove(game, { revision: "stale" })).status, 409);
      for (const confirm of [false, "true", 1, null])
        assert.equal((await remove(game, { confirm })).status, 400);
      assert.equal((await req(route(game), "DELETE", {}, admin)).status, 409);
      assert.deepEqual(snapshot(), before);
    });
    await t.test("changed registrations invalidate edit and delete reviews", async () => {
      const revision = (await plan(game)).revision;
      db.prepare("DELETE FROM entries WHERE game_id=? AND member_id=?").run(game, fourthId);
      const before = snapshot();
      assert.equal((await patch(game, { name: "Stale" }, revision)).status, 409);
      assert.equal((await remove(game, { revision })).status, 409);
      assert.deepEqual(snapshot(), before);
      entry(game, fourthId);
    });
    await t.test("changed teams invalidate a deletion review", async () => {
      const revision = (await plan(game)).revision;
      db.prepare("UPDATE team_members SET team_id='new-team' WHERE game_id=?").run(game);
      const before = snapshot();
      assert.equal((await remove(game, { revision })).status, 409);
      assert.deepEqual(snapshot(), before);
    });
    await t.test("changed details and the legacy rename endpoint invalidate reviews", async () => {
      const revision = (await plan(game)).revision;
      assert.equal((await req(`/api/games/${game}/name`, "POST", { name: "Renamed by another admin" }, admin)).status, 200);
      assert.equal((await patch(game, { time: "12:30" }, revision)).status, 409);
      assert.equal((await remove(game, { revision })).status, 409);
    });
    await t.test("concurrent edits to one revision cannot overwrite each other", async () => {
      const revision = (await plan(game)).revision;
      const responses = await Promise.all([
        patch(game, { name: "First change" }, revision), patch(game, { name: "Second change" }, revision)
      ]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    });
    await t.test("past and missing games cannot be edited or deleted", async () => {
      const past = create("2026-10-01");
      const before = snapshot();
      for (const method of ["GET", "PATCH", "DELETE"]) {
        const body = method === "GET" ? undefined : { confirm: true, revision: "test" };
        assert.equal((await req(route(past), method, body, admin)).status, 409);
        assert.equal((await req(route(999999), method, body, admin)).status, 404);
      }
      assert.deepEqual(snapshot(), before);
    });
    await t.test("a deletion failure rolls back removed registrations and teams", async () => {
      const before = snapshot();
      db.exec(`CREATE TRIGGER qa_refuse_game_delete BEFORE DELETE ON games WHEN OLD.id=${game} BEGIN SELECT RAISE(ABORT,'QA failure'); END;`);
      assert.equal((await remove(game)).status, 500);
      assert.deepEqual(snapshot(), before);
      db.exec("DROP TRIGGER qa_refuse_game_delete");
    });
    await t.test("deleting a populated game removes exactly that game and all its dependencies", async () => {
      const before = snapshot();
      assert.equal((await remove(game)).status, 200);
      assert.deepEqual(rows("games"), before.games.filter(row => row.id !== game));
      assert.deepEqual(rows("entries"), before.entries.filter(row => row.game_id !== game));
      assert.deepEqual(rows("team_members"), before.team_members.filter(row => row.game_id !== game));
      for (const table of ["members", "sessions"]) assert.deepEqual(rows(table), before[table]);
      assert.equal((await req(route(game), "DELETE", { confirm: true, revision: "old" }, admin)).status, 404);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    });
    await t.test("deleting the last game in a month falls back, and the last upcoming game yields an empty calendar", async () => {
      const january = create("2027-01-11");
      assert.equal((await remove(january)).status, 200);
      const fallback = await req("/api/calendar?month=2027-01", "GET", undefined, member);
      assert.equal(fallback.body.month, "2026-11");
      assert.equal((await remove(other)).status, 200);
      const empty = await req("/api/calendar?month=2026-11", "GET", undefined, member);
      assert.equal(empty.body.month, null); assert.deepEqual(empty.body.games, []);
      assert.equal(db.prepare("SELECT count(*) AS n FROM games WHERE date<'2026-10-24'").get().n, 1);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close(); rmSync(directory, { recursive: true, force: true });
  }
});
