import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { DatabaseSync, backup } from "node:sqlite";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, addMember, ROOT, hashToken } from "./db.mjs";
import { migrateTeamEvents } from "./migrate.mjs";
import { createApp } from "./server.mjs";

test("explicit additive team-events migration", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-team-migration-"));
  const file = path.join(directory, "club.sqlite");
  let db;
  try {
    await t.test("missing database is not created", () => {
      assert.throws(() => migrateTeamEvents(file), /not found/);
      assert.equal(existsSync(file), false);
    });
    db = new DatabaseSync(file);
    db.exec(readFileSync(path.join(ROOT, "schema.sql"), "utf8"));
    db.exec("INSERT INTO members VALUES(1,'Owner','owner@example.test','original-hash','admin'); INSERT INTO members VALUES(2,'Partner','partner@example.test','original-partner-hash','member'); INSERT INTO games VALUES(1,'2098-11-01','11:30','Existing game'); INSERT INTO entries VALUES(1,1,2); INSERT INTO entries VALUES(1,2,1); INSERT INTO sessions VALUES('original-session',1,9999999999999);");
    const before = Object.fromEntries(["members", "games", "entries", "sessions"].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
    db.close(); db = openDatabase(file);
    await t.test("new server refuses unmigrated schema without changing it", () => {
      assert.throws(() => createApp({ db }), /node migrate.mjs team-events/);
      assert.ok(!db.prepare("PRAGMA table_info(games)").all().some(c => c.name === "event_type"));
      assert.ok(!db.prepare("SELECT name FROM sqlite_master WHERE name='team_members'").get());
    });
    await t.test("migration preserves accounts, passwords, sessions, games and registrations", () => {
      const result = migrateTeamEvents(file);
      assert.equal(result.applied, true);
      assert.deepEqual(result.before, result.after);
      for (const table of ["members", "entries", "sessions"])
        assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[table]);
      assert.deepEqual(db.prepare("SELECT id,date,time,name FROM games").all(), before.games);
      assert.equal(db.prepare("SELECT event_type FROM games").get().event_type, "pairs");
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
      assert.equal(db.prepare("SELECT count(*) AS n FROM team_members").get().n, 0);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    });
    await t.test("repeated CLI migration is safe and preserves existing types", () => {
      db.exec("UPDATE games SET event_type='teams' WHERE id=1");
      const result = spawnSync(process.execPath, ["migrate.mjs", "team-events"], { cwd: ROOT, env: { ...process.env, DB_PATH: file }, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /already present/);
      assert.equal(db.prepare("SELECT event_type FROM games").get().event_type, "teams");
      assert.equal(db.prepare("SELECT count(*) AS n FROM metadata WHERE key='migration:002-team-events'").get().n, 1);
    });
    await t.test("unsupported schema and incomplete prior migrations are refused", () => {
      for (const version of [0, 2]) {
        const bad = path.join(directory, `bad-${version}.sqlite`);
        const conn = new DatabaseSync(bad);
        conn.exec(`PRAGMA user_version=${version}`); conn.close();
        assert.throws(() => migrateTeamEvents(bad), /Unsupported/);
      }
      const old = path.join(directory, "old.sqlite");
      const conn = new DatabaseSync(old);
      conn.exec(readFileSync(path.join(ROOT, "schema.sql"), "utf8").replace(",\n  name TEXT NOT NULL DEFAULT ''", ""));
      conn.close();
      assert.throws(() => migrateTeamEvents(old), /game-names first/);
    });
    await t.test("failed migration rolls back its column and metadata additions", () => {
      const bad = path.join(directory, "conflict.sqlite");
      const conn = new DatabaseSync(bad);
      conn.exec(readFileSync(path.join(ROOT, "schema.sql"), "utf8"));
      conn.exec("CREATE TABLE team_members (unexpected TEXT)");
      conn.close();
      assert.throws(() => migrateTeamEvents(bad));
      const check = new DatabaseSync(bad);
      try {
        assert.ok(!check.prepare("PRAGMA table_info(games)").all().some(c => c.name === "event_type"));
        assert.equal(check.prepare("SELECT count(*) AS n FROM metadata").get().n, 0);
      } finally { check.close(); }
    });
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("immediate formation of four-person teams", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-teams-"));
  const file = path.join(directory, "club.sqlite");
  let db, server;
  try {
    db = openDatabase(file, true);
    db.exec("INSERT INTO metadata VALUES('preview','1')");
    const password = "Teams-test-password-12345";
    const ids = [];
    for (let i = 0; i < 9; i++) ids.push(addMember(db, {
      name: `Player ${i}`, email: `player${i}@example.test`, password
    }, i === 8 ? "admin" : "member"));
    server = createApp({ db, preview: true, previewToday: "2026-10-24" });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const req = async (route, method = "GET", body, token) => {
      const res = await fetch(base + "/api" + route, { method, headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }, body: body !== undefined ? JSON.stringify(body) : undefined });
      return { status: res.status, body: (res.headers.get("content-type") || "").includes("application/json") ? await res.json() : await res.text() };
    };
    const tokens = [];
    for (let i = 0; i < ids.length; i++) tokens.push((await req("/login", "POST", { email: `player${i}@example.test`, password })).body.token);
    let gameId, pairGame;
    const rows = () => db.prepare("SELECT * FROM team_members WHERE game_id=? ORDER BY member_id").all(gameId);
    const pair = (a, b, game = gameId) => req(`/games/${game}/entry`, "POST", { partnerId: b === null ? null : ids[b] }, tokens[a]);
    const form = (a, b, c, d, game = gameId) => req(`/games/${game}/team`, "POST", { ownPartnerId: ids[b], pairMemberId: ids[c], pairPartnerId: ids[d] }, tokens[a]);
    const calendar = () => req("/calendar", "GET", undefined, tokens[0]);
    await t.test("only admin can create teams; pairs is the default and type is validated", async () => {
      assert.equal((await req("/games", "POST", { date: "2026-10-26", time: "11:30", eventType: "teams" }, tokens[0])).status, 403);
      for (const type of ["team", "", null, 1, {}])
        assert.equal((await req("/games", "POST", { date: "2026-10-26", time: "11:30", eventType: type }, tokens[8])).status, 400);
      const created = await req("/games", "POST", { date: "2026-10-26", time: "11:30", name: "Monday Teams", eventType: "teams" }, tokens[8]);
      assert.equal(created.status, 201); gameId = created.body.id;
      const other = await req("/games", "POST", { date: "2026-10-27", time: "11:30" }, tokens[8]);
      pairGame = other.body.id;
      assert.equal(other.body.eventType, "pairs");
      assert.equal((await calendar()).body.games.find(g => g.id === gameId).event_type, "teams");
    });
    await t.test("anonymous, unregistered and incomplete pairs cannot form teams", async () => {
      assert.equal((await req(`/games/${gameId}/team`, "POST", {}, undefined)).status, 401);
      assert.equal((await form(0, 1, 2, 3)).status, 409);
      await pair(0, null); await pair(2, 3);
      assert.equal((await form(0, 1, 2, 3)).status, 409);
      assert.equal(rows().length, 0);
    });
    await t.test("either member can form a team immediately without changing pairs", async () => {
      await pair(0, 1); await pair(4, 5); await pair(6, 7);
      const before = db.prepare("SELECT * FROM entries ORDER BY member_id").all();
      const result = await form(1, 0, 3, 2);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(rows().length, 4);
      assert.equal(new Set(rows().map(row => row.team_id)).size, 1);
      assert.deepEqual(db.prepare("SELECT * FROM entries ORDER BY member_id").all(), before);
      const data = (await calendar()).body;
      assert.equal(data.teams.length, 1);
      assert.deepEqual(data.teams[0].memberIds, ids.slice(0, 4));
      assert.doesNotMatch(JSON.stringify(data), /password|example\.test/);
      assert.equal((await req("/calendar/export.ics", "GET", undefined, tokens[0])).body.match(/BEGIN:VEVENT/g).length, 1);
    });
    await t.test("overlap, occupied pairs, forged ownership and pair events are refused", async () => {
      const before = rows();
      assert.equal((await form(0, 1, 1, 0)).status, 400);
      assert.equal((await form(4, 5, 2, 3)).status, 409);
      assert.equal((await form(0, 1, 4, 5)).status, 409);
      assert.equal((await form(8, 1, 4, 5)).status, 409);
      assert.equal((await form(0, 1, 2, 3, pairGame)).status, 409);
      assert.equal((await req(`/games/${gameId}/team`, "POST", { ownPartnerId: "2", pairMemberId: 3, pairPartnerId: 4 }, tokens[0])).status, 400);
      assert.deepEqual(rows(), before);
      assert.throws(() => db.prepare("INSERT INTO team_members VALUES(?,?,?)").run(gameId, ids[0], "another-team"));
    });
    await t.test("only participants can leave; either pair may dissolve without deregistering", async () => {
      const id = rows()[0].team_id;
      const entries = db.prepare("SELECT * FROM entries ORDER BY member_id").all();
      assert.equal((await req(`/games/${gameId}/team`, "DELETE", { teamId: id }, tokens[8])).status, 409);
      assert.equal((await req(`/games/${gameId}/team`, "DELETE", { teamId: "stale" }, tokens[0])).status, 409);
      assert.equal((await req(`/games/${gameId}/team`, "DELETE", { teamId: id }, tokens[3])).status, 200);
      assert.equal(rows().length, 0);
      assert.deepEqual(db.prepare("SELECT * FROM entries ORDER BY member_id").all(), entries);
    });
    await t.test("stale partnership selections cannot silently select different players", async () => {
      assert.equal((await form(0, 4, 2, 3)).status, 409);
      assert.equal((await form(0, 1, 2, 7)).status, 409);
      assert.equal(rows().length, 0);
    });
    await t.test("competing requests cannot assign the same pair twice", async () => {
      // Two requests race for pair 2/3. BEGIN IMMEDIATE and the date/member key serialize writes.
      const a = form(0, 1, 2, 3), b = form(4, 5, 2, 3);
      const results = [await a, await b];
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      assert.equal(rows().length, 4);
      const member = ids.indexOf(rows()[0].member_id);
      const id = rows()[0].team_id;
      await req(`/games/${gameId}/team`, "DELETE", { teamId: id }, tokens[member]);
    });
    await t.test("cancel dissolves the team but preserves the other pair and former partner", async () => {
      await form(0, 1, 2, 3);
      assert.equal((await req(`/games/${gameId}/entry`, "DELETE", {}, tokens[0])).status, 200);
      assert.equal(rows().length, 0);
      assert.equal(db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(gameId, ids[1]).partner_id, null);
      assert.equal(db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(gameId, ids[2]).partner_id, ids[3]);
      assert.equal(db.prepare("SELECT * FROM entries WHERE game_id=? AND member_id=?").get(gameId, ids[0]), undefined);
    });
    await t.test("old-version partnership updates and direct deletes also dissolve teams", async () => {
      await pair(0, 1); await form(0, 1, 2, 3);
      db.prepare("UPDATE entries SET partner_id=NULL WHERE game_id=? AND partner_id=?").run(gameId, ids[0]);
      assert.equal(rows().length, 0);
      db.prepare("UPDATE entries SET partner_id=? WHERE game_id=? AND member_id=?").run(ids[0], gameId, ids[1]);
      await form(0, 1, 2, 3);
      db.prepare("DELETE FROM entries WHERE game_id=? AND member_id=?").run(gameId, ids[0]);
      assert.equal(rows().length, 0);
      db.prepare("UPDATE entries SET partner_id=NULL WHERE game_id=? AND member_id=?").run(gameId, ids[1]);
      await pair(0, 1);
    });
    await t.test("failed insertion rolls back all four team members", async () => {
      db.exec(`CREATE TRIGGER fail_team_test BEFORE INSERT ON team_members WHEN NEW.member_id=${ids[3]} BEGIN SELECT RAISE(ABORT,'test insert failure'); END`);
      try {
        assert.equal((await form(0, 1, 2, 3)).status, 500);
        assert.equal(rows().length, 0);
      } finally { db.exec("DROP TRIGGER fail_team_test"); }
    });
    await t.test("date scoping, missing dates and closed dates are enforced", async () => {
      assert.equal((await form(0, 1, 2, 3, 99999)).status, 404);
      db.prepare("INSERT INTO games(id,date,time,event_type) VALUES(99,'2026-10-01','11:30','teams')").run();
      assert.equal((await form(0, 1, 2, 3, 99)).status, 409);
      assert.equal((await req("/games/99/team", "DELETE", { teamId: "anything" }, tokens[0])).status, 409);
      assert.equal(rows().length, 0);
    });
    await t.test("multiple teams, idempotent migration, backup and reopening preserve all members", async () => {
      assert.equal((await form(0, 1, 2, 3)).status, 200);
      assert.equal((await form(4, 5, 6, 7)).status, 200);
      assert.equal((await calendar()).body.teams.length, 2);
      const before = rows();
      assert.equal(migrateTeamEvents(file).applied, false);
      assert.deepEqual(rows(), before);
      const copyFile = path.join(directory, "copy.sqlite");
      await backup(db, copyFile);
      const copy = openDatabase(copyFile);
      try {
        assert.deepEqual(copy.prepare("SELECT * FROM team_members WHERE game_id=? ORDER BY member_id").all(gameId), before);
        assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
        assert.deepEqual(copy.prepare("PRAGMA foreign_key_check").all(), []);
        assert.ok(createApp({ db: copy, preview: true }));
      } finally { copy.close(); }
    });
    await t.test("the same pair can join teams on different dates without leaking between months", async () => {
      const made = await req("/games", "POST", { date: "2026-11-12", time: "11:30", eventType: "teams" }, tokens[8]);
      assert.equal(made.status, 201);
      const id = made.body.id;
      await pair(0, 1, id); await pair(2, 3, id);
      assert.equal((await form(0, 1, 2, 3, id)).status, 200);
      assert.equal((await calendar()).body.teams.length, 2);
      const next = await req("/calendar?month=2026-11", "GET", undefined, tokens[0]);
      assert.equal(next.body.teams.length, 1);
      assert.equal(next.body.teams[0].game_id, id);
      assert.equal(rows().length, 8);
    });
    await t.test("expired tokens cannot form or dissolve a team", async () => {
      db.prepare("UPDATE sessions SET expires=0 WHERE hash=?").run(hashToken(tokens[0]));
      assert.equal((await form(0, 1, 2, 3)).status, 401);
      assert.equal((await req(`/games/${gameId}/team`, "DELETE", { teamId: rows()[0].team_id }, tokens[0])).status, 401);
      assert.equal(rows().length, 8);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    db?.close(); rmSync(directory, { recursive: true, force: true });
  }
});
