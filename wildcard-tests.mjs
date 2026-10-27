import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, addMember, hashToken } from "./db.mjs";
import { createApp } from "./server.mjs";

test("wildcard placeholder members", async t => {
  const dir = mkdtempSync(path.join(tmpdir(), "cabc-wildcard-"));
  const file = path.join(dir, "club.sqlite");
  const password = "Fictional-wildcard-test-12345";
  let db, server;
  try {
    db = openDatabase(file, true);
    // -Guest- is created first so its id sits below every real member, while
    // -Standby- and -Unavailable- are created last so their ids sit above them.
    const guest = addMember(db, { name: "-Guest-", email: "wildcard-guest@example.test", password });
    const ids = [addMember(db, { name: "Admin One", email: "admin1@example.test", password }, "admin")];
    for (let i = 1; i <= 6; i++)
      ids.push(addMember(db, { name: `Person ${i}`, email: `person${i}@example.test`, password }, i === 1 ? "admin" : "member"));
    const standby = addMember(db, { name: "-Standby-", email: "wildcard-standby@example.test", password });
    const unavailable = addMember(db, { name: "-Unavailable-", email: "wildcard-unavailable@example.test", password });
    const insertGame = db.prepare("INSERT INTO games(date,time,name,event_type) VALUES(?,'11:30','',?)");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const offset = n => new Date(new Date(today + "T12:00:00Z").valueOf() + n * 86400000).toISOString().slice(0, 10);
    const past = offset(-1), g1Date = offset(7), g2Date = offset(10), g3Date = offset(40);
    for (const [date, type] of [[past, "pairs"], [g1Date, "pairs"], [g2Date, "teams"], [g3Date, "pairs"]])
      insertGame.run(date, type);
    const gameId = date => db.prepare("SELECT id FROM games WHERE date=?").get(date).id;
    const pastId = gameId(past), g1 = gameId(g1Date), g2 = gameId(g2Date), g3 = gameId(g3Date);

    server = createApp({ db }); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const req = async (route, method = "GET", body, token) => {
      const response = await fetch(base + route, { method, headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }, body: body !== undefined ? JSON.stringify(body) : undefined });
      return { status: response.status, body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text() };
    };
    const login = async email => (await req("/login", "POST", { email, password })).body.token;
    const tokens = [];
    for (let i = 0; i < ids.length; i++) tokens.push(await login(`person${i === 0 ? "" : i}@example.test`));
    const adminToken = await login("admin1@example.test");
    const register = (game, partner, token = tokens[1]) => req(`/games/${game}/entry`, "POST", { partnerId: partner }, token);
    const cancel = (game, token = tokens[1]) => req(`/games/${game}/entry`, "DELETE", {}, token);
    const calendar = async month => (await req(`/calendar${month ? `?month=${month}` : ""}`, "GET", undefined, tokens[1])).body;

    await t.test("placeholder accounts cannot sign in or keep sessions", async () => {
      for (const email of ["wildcard-guest@example.test", "wildcard-standby@example.test", "wildcard-unavailable@example.test"]) {
        const result = await req("/login", "POST", { email, password });
        assert.equal(result.status, 401);
        assert.equal(result.body.error, "This placeholder account cannot sign in.");
      }
      // A session row created by older code is also rejected by auth().
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hashToken("stale-wildcard-session"), guest, Date.now() + 3600000);
      assert.equal((await req("/calendar", "GET", undefined, "stale-wildcard-session")).status, 401);
    });

    const rows = sql => db.prepare(sql).all().map(r => ({ ...r }));

    await t.test("several members can overbook one placeholder while real members stay exclusive", async () => {
      assert.equal((await register(g1, guest)).status, 200);
      assert.equal((await register(g1, guest, tokens[2])).status, 200);
      // Only the real members' rows exist: no reciprocal placeholder-owned rows.
      assert.deepEqual(
        rows(`SELECT member_id,partner_id FROM entries WHERE game_id=${g1} ORDER BY member_id`),
        [{ member_id: ids[1], partner_id: guest }, { member_id: ids[2], partner_id: guest }]
      );
      // A real member already paired with someone real is not available.
      assert.equal((await register(g1, ids[6], tokens[5])).status, 200);
      assert.equal((await register(g1, ids[6], tokens[4])).status, 409);
      await cancel(g1, tokens[5]);
    });

    await t.test("calendar lists assignments, excludes placeholder-owned rows and spans months", async () => {
      // A legacy symmetric row written by the old server must disappear from reads.
      db.exec(`INSERT INTO entries VALUES(${g1},${guest},${ids[1]})`);
      const result = await calendar(g1Date.slice(0, 7));
      assert.ok(!result.entries.some(e => e.member_id === guest));
      const listed = new Set(result.entries.filter(e => e.game_id === g1).map(e => `${e.member_id}:${e.partner_id}`));
      assert.ok(listed.has(`${ids[1]}:${guest}`));
      assert.ok(listed.has(`${ids[2]}:${guest}`));
      assert.ok(!listed.has(`${guest}:${ids[1]}`));
      assert.ok(!listed.has(`${guest}:null`));
      const wildcards = result.wildcards.map(w => w.name).sort();
      assert.deepEqual(wildcards, ["-Guest-", "-Standby-", "-Unavailable-"]);
      const guestSchedule = result.wildcards.find(w => w.id === guest).schedule;
      assert.equal(guestSchedule.length, 2);
      assert.deepEqual(guestSchedule.map(r => r.memberId).sort(), [ids[1], ids[2]]);
      // The cross-month assignment is visible while viewing the earlier month.
      assert.equal((await register(g3, guest, tokens[3])).status, 200);
      const earlier = await calendar(g1Date.slice(0, 7));
      const schedule = earlier.wildcards.find(w => w.id === guest).schedule;
      assert.deepEqual(schedule.map(r => r.gameId).sort(), [g1, g1, g3]);
      assert.ok(earlier.months.includes(g3Date.slice(0, 7)));
    });

    await t.test("standby and unavailable are member states, not pairs", async () => {
      assert.equal((await register(g1, standby, tokens[6])).status, 200);
      assert.equal((await register(g1, unavailable, tokens[5])).status, 200);
      const result = await calendar(g1Date.slice(0, 7));
      const rows = result.entries.filter(e => e.game_id === g1);
      assert.ok(rows.some(e => e.member_id === ids[6] && e.partner_id === standby));
      assert.ok(rows.some(e => e.member_id === ids[5] && e.partner_id === unavailable));
      // -Unavailable- blocks the member from being chosen as someone's partner.
      assert.equal((await register(g1, ids[5], tokens[4])).status, 409);
      // Neither state lets the pair complete a team.
      assert.equal((await register(g2, standby, tokens[6])).status, 200);
      assert.equal((await register(g2, standby, tokens[5])).status, 200);
      const team = await req(`/games/${g2}/team`, "POST", { pairMemberId: ids[6], pairPartnerId: standby, ownPartnerId: standby }, tokens[5]);
      assert.equal(team.status, 409);
      assert.equal(team.body.error, "Unavailable and standby members cannot form teams.");
    });

    await t.test("cancelling removes only the cancelling member's assignment", async () => {
      assert.equal((await cancel(g1, tokens[2])).status, 200);
      assert.deepEqual(
        rows(`SELECT member_id,partner_id FROM entries WHERE game_id=${g1} AND partner_id=${guest} ORDER BY member_id`),
        [{ member_id: ids[1], partner_id: guest }]
      );
      const result = await calendar(g1Date.slice(0, 7));
      assert.deepEqual(result.wildcards.find(w => w.id === guest).schedule.map(r => r.memberId), [ids[1], ids[3]]);
      // A fresh registration also cleans up legacy placeholder-owned rows.
      db.exec(`DELETE FROM entries WHERE game_id=${g1} AND member_id=${guest}; INSERT INTO entries VALUES(${g1},${guest},${ids[2]})`);
      assert.equal((await register(g1, guest, tokens[2])).status, 200);
      assert.equal(db.prepare("SELECT count(*) AS n FROM entries WHERE game_id=? AND member_id=?").get(g1, guest).n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM entries WHERE game_id=? AND member_id=? AND partner_id=?").get(g1, ids[2], guest).n, 1);
    });

    await t.test("guest pairs complete teams, including two guests with the same marker", async () => {
      assert.equal((await register(g2, guest, tokens[1])).status, 200);
      assert.equal((await register(g2, guest, tokens[2])).status, 200);
      // Person 3 and Person 4 form the other real pair; one call registers both.
      assert.equal((await register(g2, ids[4], tokens[3])).status, 200);
      // The same placeholder appears in two pairs of one team; only real ids are stored.
      const team = await req(`/games/${g2}/team`, "POST", { pairMemberId: ids[3], pairPartnerId: ids[4], ownPartnerId: guest }, tokens[1]);
      assert.equal(team.status, 200);
      const stored = rows(`SELECT member_id FROM team_members WHERE game_id=${g2} ORDER BY member_id`);
      assert.deepEqual(stored, [{ member_id: ids[1] }, { member_id: ids[3] }, { member_id: ids[4] }]);
      // Two different real members in both pairs are still rejected.
      assert.equal((await req(`/games/${g2}/team`, "POST", { pairMemberId: ids[1], pairPartnerId: guest, ownPartnerId: guest }, tokens[2])).status, 409);
    });

    await t.test("placeholder deactivation review counts assignments and clears them", async () => {
      db.exec(`INSERT INTO entries VALUES(${pastId},${ids[5]},${guest}); INSERT INTO entries VALUES(${pastId},${ids[6]},${guest})`);
      const review = await req(`/members/${guest}/deactivate`, "GET", undefined, adminToken);
      assert.equal(review.status, 200);
      const plan = review.body;
      assert.equal(plan.isWildcard, true);
      assert.equal(plan.assignmentCount, 5); // g1: Person 1, Person 2; g2: Person 1, Person 2; g3: Person 3
      assert.equal(plan.affectedGames, 3);
      const historical = db.prepare("SELECT * FROM entries WHERE game_id=? ORDER BY member_id").all(pastId);
      const apply = await req(`/members/${guest}/deactivate`, "POST", { confirm: true, revision: plan.revision }, adminToken);
      assert.equal(apply.status, 200);
      assert.equal(db.prepare("SELECT active FROM members WHERE id=?").get(guest).active, 0);
      // Future assignments are cleared; affected members stay as singles.
      assert.equal(db.prepare("SELECT count(*) AS n FROM entries WHERE partner_id=? AND game_id<>?").get(guest, pastId).n, 0);
      for (const [game, member] of [[g1, ids[1]], [g1, ids[2]], [g2, ids[1]], [g2, ids[2]], [g3, ids[3]]]) {
        const row = db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(game, member);
        assert.ok(row, `member ${member} stays registered`);
        assert.equal(row.partner_id, null);
      }
      assert.deepEqual(db.prepare("SELECT * FROM entries WHERE game_id=? ORDER BY member_id").all(pastId), historical);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE member_id=?").get(guest).n, 0);
      const result = await calendar(g1Date.slice(0, 7));
      assert.equal(result.wildcards.find(w => w.id === guest).schedule.length, 0);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    db?.close(); rmSync(dir, { recursive: true, force: true });
  }
});
