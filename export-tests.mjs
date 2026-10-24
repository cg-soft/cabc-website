import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { openDatabase, addMember, hashToken } from "./db.mjs";
import { createApp } from "./server.mjs";
import { registeredGamesCalendar } from "./icalendar.mjs";

const unfold = value => value.replace(/\r\n[ \t]/g, "");
test("iCalendar formatting", async t => {
  const fixture = { id: 1, date: "2026-03-08", time: "11:30", name: "Sunday Duplicate" };
  const now = new Date("2026-03-07T12:34:56.789Z");
  await t.test("Pacific start times include standard and daylight observances", () => {
    const text = registeredGamesCalendar([fixture], now);
    assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
    assert.match(text, /DTSTAMP:20260307T123456Z\r\n/);
    assert.match(text, /DTSTART;TZID=America\/Los_Angeles:20260308T113000\r\n/);
    assert.match(text, /TZOFFSETFROM:-0800\r\nTZOFFSETTO:-0700/);
    assert.match(text, /RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU/);
    assert.match(text, /TZOFFSETFROM:-0700\r\nTZOFFSETTO:-0800/);
    assert.match(text, /RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU/);
    assert.doesNotMatch(text, /\r\n(?:DTEND|DURATION|ATTENDEE|ORGANIZER|VALARM)[:;]/);
    assert.match(text, /END:VEVENT\r\nEND:VCALENDAR\r\n$/);
    assert.doesNotMatch(text.replaceAll("\r\n", ""), /[\r\n]/);
  });
  await t.test("text escapes delimiters, backslashes and injection-shaped newlines", () => {
    const text = registeredGamesCalendar([{ ...fixture, name: "Pairs, A; B\\C\r\nEND:VEVENT\nBEGIN:VEVENT\u0000" }], now);
    const logical = unfold(text);
    assert.match(logical, /SUMMARY:Pairs\\, A\\; B\\\\C\\nEND:VEVENT\\nBEGIN:VEVENT\r\n/);
    assert.equal(text.split("\r\nBEGIN:VEVENT\r\n").length - 1, 1);
    assert.equal(text.split("\r\nEND:VEVENT\r\n").length - 1, 1);
    assert.doesNotMatch(text, /\u0000/);
  });
  await t.test("long Unicode lines fold at 75 UTF-8 octets without corrupting text", () => {
    const name = "橋牌".repeat(35) + " ♠️";
    const text = registeredGamesCalendar([{ ...fixture, name }], now);
    assert.ok(text.split("\r\n").every(line => Buffer.byteLength(line, "utf8") <= 75));
    assert.ok(unfold(text).includes(`SUMMARY:${name}\r\n`));
    assert.equal(Buffer.from(text).toString("utf8"), text);
  });
  await t.test("UID is stable across exports and renames; blank names have a fallback", () => {
    const first = registeredGamesCalendar([fixture], now);
    const second = registeredGamesCalendar([{ ...fixture, name: "" }], new Date("2026-03-08T12:34:56Z"));
    assert.equal(/UID:(.+)/.exec(first)[1], /UID:(.+)/.exec(second)[1]);
    assert.match(second, /SUMMARY:Chinese American Bridge Club/);
    assert.throws(() => registeredGamesCalendar([{ ...fixture, time: "11:30\nBEGIN:VEVENT" }]));
  });
  await t.test("apex-domain link preserves the exact legacy event identity", () => {
    const text = registeredGamesCalendar([fixture], now);
    assert.ok(text.includes("\r\nURL:https://cabc.club/#calendar\r\n"));
    assert.ok(text.includes("\r\nUID:cabc-game-1-2026-03-08@bridge.cabc.club\r\n"));
    assert.doesNotMatch(text, /\r\nURL:https:\/\/bridge\.cabc\.club/);
  });
});

test("authenticated registered-games export", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-export-"));
  let db, server;
  try {
    db = openDatabase(path.join(directory, "club.sqlite"), true);
    db.exec("INSERT INTO metadata VALUES('preview','1')");
    const password = "Export-fixture-password-12345";
    const alice = addMember(db, { name: "Alice Private", email: "alice@example.test", password });
    const bob = addMember(db, { name: "Bob Private", email: "bob@example.test", password });
    const owner = addMember(db, { name: "Owner Private", email: "owner@example.test", password }, "admin");
    const nobody = addMember(db, { name: "No Games", email: "none@example.test", password });
    const game = db.prepare("INSERT INTO games(id,date,time,name) VALUES(?,?,?,?)");
    game.run(1, "2026-03-06", "11:30", "Past registered game");
    game.run(2, "2026-03-07", "11:30", "Today Duplicate");
    game.run(3, "2026-03-08", "11:30", "Spring Duplicate");
    game.run(4, "2026-11-01", "11:30", "");
    game.run(5, "2027-01-04", "11:30", "Other members only");
    const entry = db.prepare("INSERT INTO entries VALUES(?,?,?)");
    for (const id of [1, 2, 4]) entry.run(id, alice, null);
    entry.run(3, alice, bob); entry.run(3, bob, alice);
    entry.run(5, owner, null);
    server = createApp({ db, preview: true, previewToday: "2026-03-07" });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = async email => {
      const res = await fetch(base + "/api/login", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(res.status, 200); return (await res.json()).token;
    };
    const token = await login("alice@example.test"), other = await login("bob@example.test");
    const admin = await login("owner@example.test"), empty = await login("none@example.test");
    const expired = await login("alice@example.test");
    db.prepare("UPDATE sessions SET expires=0 WHERE hash=?").run(hashToken(expired));
    const get = (key, suffix = "") => fetch(base + "/api/calendar/export.ics" + suffix,
      { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    const snapshot = () => JSON.stringify(Object.fromEntries(
      ["members", "games", "entries", "sessions", "metadata"].map(table =>
        [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
    const before = snapshot();
    await t.test("anonymous, invalid, expired and query-string credentials are refused", async () => {
      for (const key of [undefined, "invalid", expired]) assert.equal((await get(key)).status, 401);
      assert.equal((await get(undefined, `?token=${token}`)).status, 401);
    });
    await t.test("only own current/future games across months are exported once", async () => {
      const res = await get(token, `?memberId=${owner}&month=2026-03`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/calendar; charset=utf-8");
      assert.match(res.headers.get("content-disposition"), /attachment; filename="cabc-my-games.ics"/);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      const body = unfold(await res.text());
      assert.equal((body.match(/BEGIN:VEVENT/g) || []).length, 3);
      for (const id of [2, 3, 4]) assert.ok(body.includes(`UID:cabc-game-${id}-`));
      assert.doesNotMatch(body, /Past registered game|Other members only/);
      assert.doesNotMatch(body, /Alice Private|Bob Private|Owner Private|example\.test|Export-fixture/);
      assert.ok(!body.includes(token));
      assert.match(body, /URL:https:\/\/cabc\.club\/#calendar/);
      assert.match(body, /UID:cabc-game-2-2026-03-07@bridge\.cabc\.club\r\n/);
      assert.match(body, /SUMMARY:Chinese American Bridge Club/);
      assert.deepEqual(snapshot(), before);
    });
    await t.test("partners receive the same event identity, not another account's schedule", async () => {
      const a = unfold(await (await get(token)).text());
      const b = unfold(await (await get(other)).text());
      assert.equal((b.match(/BEGIN:VEVENT/g) || []).length, 1);
      assert.equal(/UID:cabc-game-3-.+/.exec(a)[0], /UID:cabc-game-3-.+/.exec(b)[0]);
    });
    await t.test("administrator export is also restricted to that administrator's registrations", async () => {
      const body = await (await get(admin)).text();
      assert.equal((body.match(/BEGIN:VEVENT/g) || []).length, 1);
      assert.match(body, /Other members only/);
      assert.doesNotMatch(body, /Today Duplicate|Spring Duplicate/);
    });
    await t.test("no registered games returns a helpful JSON error, not an empty download", async () => {
      const res = await get(empty);
      assert.equal(res.status, 404);
      assert.match((await res.json()).error, /no registered games for today or later/);
      assert.equal(res.headers.get("content-disposition"), null);
      assert.equal(snapshot(), before);
      assert.ok(nobody);
    });
    await t.test("cancellation is reflected in the next export; partner remains registered", async () => {
      const res = await fetch(base + "/api/games/3/entry", { method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(res.status, 200);
      assert.doesNotMatch(await (await get(token)).text(), /Spring Duplicate/);
      assert.match(await (await get(other)).text(), /Spring Duplicate/);
      assert.equal(db.prepare("SELECT partner_id FROM entries WHERE game_id=3 AND member_id=?").get(bob).partner_id, null);
    });
    await t.test("logout invalidates exports and serializer source is not publicly served", async () => {
      await fetch(base + "/api/logout", { method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      assert.equal((await get(token)).status, 401);
      assert.equal((await fetch(base + "/icalendar.mjs")).status, 404);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    db?.close(); rmSync(directory, { recursive: true, force: true });
  }
});
