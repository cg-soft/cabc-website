import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { once } from "node:events";
import { openDatabase, addMember, hashToken } from "./db.mjs";
import { createApp } from "./server.mjs";

test("upcoming member assignments span months with role-scoped reads and live updates", async t => {
  const dir = mkdtempSync(path.join(tmpdir(), "cabc-own-dates-"));
  let db, server;
  try {
    db = openDatabase(path.join(dir, "club.sqlite"), true);
    db.exec("INSERT INTO metadata VALUES('preview','1')");
    const member = name => addMember(db, { name, email: `${name.replace(/\W/g, "")}@example.test`, password: "Own-dates-fixture-12345" });
    const alice = member("Alice"), bob = member("Bob"), empty = member("No dates");
    const carol = member("Carol"), dave = member("Dave");
    const admin = addMember(db, { name: "Admin", email: "admin@example.test", password: "Own-dates-fixture-12345" }, "admin");
    const guest = member("-Guest-"), standby = member("-Standby-"), unavailable = member("-Unavailable-");
    const game = db.prepare("INSERT INTO games(id,date,time,name,event_type) VALUES(?,?,'11:30',?,?)");
    for (const [id, date, type] of [[1, "2026-10-23", "pairs"], [2, "2026-10-24", "pairs"],
      [3, "2026-11-05", "teams"], [4, "2026-11-12", "pairs"], [5, "2027-01-07", "pairs"], [6, "2027-01-14", "pairs"]])
      game.run(id, date, `Game ${id}`, type);
    const entry = db.prepare("INSERT INTO entries VALUES(?,?,?)");
    entry.run(1, alice, null); entry.run(2, alice, null);
    entry.run(3, alice, bob); entry.run(3, bob, alice);
    entry.run(3, carol, dave); entry.run(3, dave, carol);
    entry.run(4, alice, guest); entry.run(5, alice, standby); entry.run(6, alice, unavailable);
    entry.run(2, admin, null);
    for (const id of [alice, bob, carol, dave])
      db.prepare("INSERT INTO team_members(game_id,member_id,team_id) VALUES(?,?,?)").run(3, id, "qa-team");
    const tokens = new Map([alice, bob, empty, admin].map(id => [id, id.toString(16).padStart(64, "0")]));
    for (const [id, token] of tokens)
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hashToken(token), id, Date.now() + 3600000);
    server = createApp({ db, preview: true, previewToday: "2026-10-24" });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const get = async (id, month = "2026-10") => {
      const response = await fetch(`${base}/calendar?month=${month}`, { headers: { Authorization: `Bearer ${tokens.get(id)}` } });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    };
    await t.test("ordinary member gets all current assignments, never other members' rows", async () => {
      const result = await get(alice);
      assert.deepEqual(result.memberAssignments.map(r => r.gameId), [2, 3, 4, 5, 6]);
      assert.ok(result.memberAssignments.every(r => r.memberId === alice));
      assert.equal(result.memberAssignments[1].partnerName, "Bob");
      assert.equal(result.memberAssignments[1].teamId, "qa-team");
      assert.deepEqual(result.memberAssignments.slice(2).map(r => r.partnerId), [guest, standby, unavailable]);
      assert.ok(result.memberAssignments.every(r => !("email" in r) && !("password" in r)));
      assert.deepEqual((await get(alice, "2026-11")).memberAssignments, result.memberAssignments);
      assert.deepEqual((await get(bob)).memberAssignments.map(r => r.gameId), [3]);
    });
    await t.test("administrator can render any acting member from the same response", async () => {
      const rows = (await get(admin)).memberAssignments;
      assert.deepEqual([...new Set(rows.map(r => r.memberId))].sort((a, b) => a - b), [alice, bob, carol, dave, admin].sort((a, b) => a - b));
      assert.equal(rows.filter(r => r.memberId === alice).length, 5);
    });
    await t.test("no assignments is an explicit empty array", async () => {
      assert.deepEqual((await get(empty)).memberAssignments, []);
    });
    await t.test("cancellation and re-registration immediately update the list", async () => {
      const headers = { Authorization: `Bearer ${tokens.get(alice)}`, "Content-Type": "application/json" };
      const removed = await fetch(`${base}/games/2/entry`, { method: "DELETE", headers });
      assert.equal(removed.status, 200);
      assert.deepEqual((await get(alice)).memberAssignments.map(r => r.gameId), [3, 4, 5, 6]);
      const added = await fetch(`${base}/games/2/entry`, { method: "POST", headers, body: JSON.stringify({ partnerId: null }) });
      assert.equal(added.status, 200);
      assert.deepEqual((await get(alice)).memberAssignments.map(r => r.gameId), [2, 3, 4, 5, 6]);
    });
    await t.test("anonymous calendar read is denied", async () => {
      assert.equal((await fetch(`${base}/calendar`)).status, 401);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close(); rmSync(dir, { recursive: true, force: true });
  }
});

function browserModel() {
  const handlers = {}, nodes = {};
  const node = () => ({ innerHTML: "", setAttribute() {}, getAttribute() { return "false"; }, addEventListener() {}, replaceChildren() { this.innerHTML = ""; }, querySelector() { return {}; } });
  const app = node(); app.querySelector = () => node();
  const document = {
    activeElement: null, querySelector: selector => selector === "#app" ? app : nodes[selector] ||= node(),
    addEventListener: (name, handler) => { handlers[name] = handler; }
  };
  const sandbox = { document, window: { addEventListener() {} } };
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  vm.runInNewContext(source.replace("  route();\n})();",
    "  window.model = { state, ownDatesPanel, wildcardPanel, danceCard, drawCalendar }; \n})();"), sandbox);
  const model = sandbox.window.model;
  Object.assign(model.state, { user: { id: 1, name: "Alice <QA>", role: "member" }, month: "2026-10", selected: "2026-10-24",
    calendar: { today: "2026-10-24", months: ["2026-10"], members: [{ id: 1, name: "Alice <QA>", active: 1 }, { id: 2, name: "Bob", active: 1 }],
      games: [{ id: 1, date: "2026-10-24", time: "11:30", name: "", event_type: "pairs" }], entries: [], teams: [],
      wildcards: [{ id: 3, name: "-Standby-", type: "standby", schedule: [] }],
      memberAssignments: [
        { gameId: 1, date: "2026-10-24", time: "11:30", gameName: "<Game>", eventType: "pairs", memberId: 1, partnerId: null },
        { gameId: 2, date: "2027-01-01", time: "11:30", gameName: "Future team", eventType: "teams", memberId: 1, partnerId: 2, partnerName: "Bob & QA", teamId: "team" },
        { gameId: 3, date: "2027-01-02", time: "11:30", gameName: "Standby", eventType: "pairs", memberId: 1, partnerId: 3 },
        { gameId: 4, date: "2026-10-23", time: "11:30", gameName: "Past", memberId: 1 },
        { gameId: 5, date: "2026-10-24", time: "11:30", gameName: "Other member", memberId: 2 }
      ] }
  });
  return { ...model, handlers, nodes };
}

test("My Own Dates renders escaped cross-month statuses without past or other-member entries", () => {
  const model = browserModel(), html = model.ownDatesPanel();
  assert.match(html, /Alice &lt;QA&gt;/); assert.match(html, /&lt;Game&gt;/);
  assert.match(html, /Bob &amp; QA/); assert.match(html, /Team formed/);
  assert.match(html, /On standby/); assert.match(html, /partner needed/);
  assert.match(html, /2027/);
  assert.equal((html.match(/data-action="own-date-jump"/g) || []).length, 3);
  assert.doesNotMatch(html, />Past<|>Other member</);
});

test("My Own Dates distinguishes empty schedules from an older backend", () => {
  const model = browserModel();
  model.state.calendar.memberAssignments = [];
  assert.match(model.ownDatesPanel(), /No assignments for today or later/);
  delete model.state.calendar.memberAssignments;
  assert.match(model.ownDatesPanel(), /updated server is running/);
  assert.doesNotMatch(model.ownDatesPanel(), /No assignments/);
});

test("dance card renders unnumbered single-line pairs and two pair lines per team", () => {
  const model = browserModel();
  model.state.calendar.entries = [
    { game_id: 1, member_id: 1, partner_id: 2, name: "Alice <QA>" },
    { game_id: 1, member_id: 2, partner_id: 1, name: "Bob" },
    { game_id: 1, member_id: 4, partner_id: 5, name: "Casey" },
    { game_id: 1, member_id: 5, partner_id: 4, name: "Morgan" }
  ];
  model.state.calendar.members.push({ id: 4, name: "Casey" }, { id: 5, name: "Morgan" });
  const pairs = model.danceCard();
  assert.match(pairs, /<li>Alice &lt;QA&gt; \+ Bob<\/li>/);
  assert.match(pairs, /<li>Casey \+ Morgan<\/li>/);
  model.state.calendar.games[0].event_type = "teams";
  model.state.calendar.teams = [{ id: "qa", game_id: 1, memberIds: [1, 2, 4, 5] }];
  const team = model.danceCard().match(/<ol class="team-list">([\s\S]*?)<\/ol>/)?.[1];
  assert.ok(team);
  assert.equal((team.match(/<p>/g) || []).length, 2);
  assert.match(team, /<p>Alice &lt;QA&gt; \+ Bob<\/p>/);
  assert.match(team, /<p>Casey \+ Morgan<\/p>/);
  model.state.calendar.teams = [];
  assert.match(model.danceCard(), /<li>Alice &lt;QA&gt; \+ Bob<\/li>/);
  const css = readFileSync(new URL("./public/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /counter-(?:reset|increment):pairs|counter\(pairs/);
  for (const selector of ["\\.pairs li", "\\.team-item p"])
    assert.match(css, new RegExp(`${selector}\\{[^}]*white-space:nowrap;overflow-x:auto`));
});

test("Show assignment lists omit weekday prefixes and numbered gutters and keep time unwrapped", () => {
  const model = browserModel();
  model.state.calendar.wildcards[0].schedule = [{
    gameId: 1, date: "2026-10-24", time: "11:30", gameName: "Game",
    eventType: "pairs", memberName: "Alice"
  }];
  model.state.showWildcard = 3;
  for (const html of [model.ownDatesPanel(), model.wildcardPanel()]) {
    const dates = [...html.matchAll(/<span class="jump-date">([\s\S]*?)<\/span><\/span>/g)];
    assert.ok(dates.length);
    for (const [, date] of dates) {
      assert.match(date, /<span>11:30 am$/);
      assert.doesNotMatch(date, /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b| · /);
    }
  }
  const css = readFileSync(new URL("./public/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /counter-(?:reset|increment):jumps|counter\(jumps/);
  assert.match(css, /\.wildcard-schedule button\{[^}]*padding:var\(--space-3\);/);
  assert.match(css, /\.jump-date span\{[^}]*white-space:nowrap/);
  assert.match(css, /\.jump-date strong\{[^}]*white-space:nowrap/);
  assert.match(css, /\.jump-date\{[^}]*flex-shrink:0/);
});

test("Show panels use single concise headings and omit wildcard assignment counts", () => {
  const model = browserModel();
  const own = model.ownDatesPanel();
  assert.match(own, /<h2>Your schedule<\/h2>/);
  assert.doesNotMatch(own, /<h2>My Own Dates|class="eyebrow"/);
  model.state.showWildcard = 3;
  for (const [type, title] of Object.entries({
    standby: "Standby Schedule", unavailable: "Dates marked Unavailable", guest: "Guest Schedule"
  })) {
    model.state.calendar.wildcards[0].type = type;
    model.state.calendar.wildcards[0].schedule = [{
      gameId: 1, date: "2026-10-24", time: "11:30", gameName: "Game",
      eventType: "teams", memberName: "Alice"
    }];
    const html = model.wildcardPanel();
    assert.match(html, new RegExp(`<h2>${title}</h2>`));
    assert.doesNotMatch(html, /Placeholder schedule|Upcoming assignments|1 assignment/);
    assert.match(html, /Team event/);
    assert.match(html, /Alice/);
  }
});

test("Show handles own selection without wildcards and preserves it when Acting for changes", () => {
  const model = browserModel();
  model.state.calendar.wildcards = [];
  model.drawCalendar();
  assert.match(model.nodes["#calendar-content"].innerHTML, /My Own Dates/);
  const select = { value: "own" };
  model.handlers.change({ target: { closest: selector => selector.includes("data-show") ? select : null } });
  assert.equal(model.state.showWildcard, "own");
  assert.match(model.nodes["#calendar-content"].innerHTML, /value="own" selected/);
  model.state.user.role = "admin"; model.state.calendar.registrationRevisions = {};
  const acting = { value: "2" };
  model.handlers.change({ target: { closest: selector => selector.includes("data-acting") ? acting : null } });
  assert.equal(model.state.showWildcard, "own");
  assert.equal(model.state.actingMemberId, 2);
  assert.match(model.ownDatesPanel(), /Other member/);
  select.value = "";
  model.handlers.change({ target: { closest: selector => selector.includes("data-show") ? select : null } });
  assert.equal(model.state.showWildcard, null);
});
