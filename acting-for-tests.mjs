import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { openDatabase, addMember, hashToken } from "./db.mjs";
import { createApp } from "./server.mjs";
import { migrateRegistrationAudit } from "./migrate.mjs";

function browserModel() {
  const handlers = {};
  const select = {};
  const container = { innerHTML: "", querySelector: () => select, replaceChildren() { this.innerHTML = ""; } };
  const status = { innerHTML: "", replaceChildren() { this.innerHTML = ""; } };
  const dialog = { addEventListener() {}, open: false };
  const sandbox = {
    document: {
      querySelector: selector => selector === "#dialog" ? dialog : selector === "#acting-controls" ? container : selector === "#acting-status" ? status : {},
      addEventListener: (name, handler) => { handlers[name] = handler; }
    },
    window: { addEventListener() {} }
  };
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  vm.runInNewContext(source.replace("  route();\n})();",
    "  window.model = { state, schedulingMember, actingForMember, schedulingFields, drawActingControls, calendarShell };\n})();"), sandbox);
  const model = sandbox.window.model;
  Object.assign(model.state, {
    user: { id: 1, name: "QA Administrator", role: "admin" },
    calendar: {
      members: [{ id: 1, name: "QA Administrator", active: 1 }, { id: 2, name: "QA <Member>", active: 1 },
        { id: 3, name: "-Guest-", active: 1 }, { id: 4, name: "QA Inactive", active: 0 }],
      wildcards: [{ id: 3, name: "-Guest-", type: "guest" }],
      registrationRevisions: { 7: "reviewed-revision" }
    }
  });
  return { ...model, handlers, container, status, select, dialog };
}

test("new browser fails closed when the previous server lacks delegated-scheduling support", () => {
  const model = browserModel();
  delete model.state.calendar.registrationRevisions;
  model.state.actingMemberId = 2;
  assert.equal(model.actingForMember(), false);
  assert.equal(model.schedulingMember().id, 1);
  assert.equal(JSON.stringify(model.schedulingFields(7)), "{}");
  model.drawActingControls();
  assert.equal(model.state.actingMemberId, null);
  assert.match(model.status.innerHTML, /updated server/);
  assert.match(model.container.innerHTML, /QA Administrator/);
  assert.doesNotMatch(model.container.innerHTML, /<select/);
});

test("acting selector escapes names, excludes inactive/placeholders and scopes scheduling payloads", () => {
  const model = browserModel();
  model.state.actingMemberId = 2;
  model.drawActingControls();
  assert.match(model.container.innerHTML, /QA &lt;Member&gt;/);
  assert.doesNotMatch(model.container.innerHTML, /<option value="[34]"/);
  assert.equal(model.schedulingMember().id, 2);
  assert.equal(JSON.stringify(model.schedulingFields(7)), '{"memberId":2,"revision":"reviewed-revision","confirm":true}');
  assert.equal(model.state.user.id, 1);
});

test("pending writes and open confirmations block target changes", async () => {
  const model = browserModel();
  for (const pending of [true, false]) {
    model.state.schedulingPending = pending; model.dialog.open = !pending;
    const select = { value: "2" };
    model.handlers.change({ target: { closest: () => select } });
    assert.equal(model.state.actingMemberId, null);
    assert.equal(select.value, "");
  }
  model.state.schedulingPending = true;
  let prevented = false;
  await model.handlers.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test("a demoted administrator cannot retain another member's scheduling perspective", () => {
  const model = browserModel();
  model.state.actingMemberId = 2;
  model.state.user.role = "member";
  assert.equal(model.schedulingMember().id, 1);
  assert.equal(model.actingForMember(), false);
  model.drawActingControls();
  assert.equal(model.state.actingMemberId, null);
  assert.match(model.container.innerHTML, /QA Administrator/);
  assert.doesNotMatch(model.container.innerHTML, /<select/);
  assert.equal(model.status.innerHTML, "");
});

test("administrator selector replaces header identity beside Home and Log out", () => {
  const model = browserModel();
  const shell = model.calendarShell();
  const header = shell.slice(0, shell.indexOf("</header>"));
  assert.match(header, /id="acting-controls"[\s\S]*data-action="home"[\s\S]*data-action="logout"/);
  assert.equal((shell.match(/id="acting-controls"/g) || []).length, 1);
  assert.match(shell.slice(shell.indexOf("</header>")), /id="acting-status"/);
  model.drawActingControls();
  assert.match(model.container.innerHTML, /Myself \(QA Administrator\)/);
  assert.equal(model.status.innerHTML, "");
  model.state.actingMemberId = 2;
  model.drawActingControls();
  assert.match(model.container.innerHTML, /Signed in as QA Administrator/);
  assert.match(model.status.innerHTML, /Acting for QA &lt;Member&gt;/);
  assert.match(model.status.innerHTML, /acting-reset/);
  model.state.actingMemberId = null;
  model.drawActingControls();
  assert.equal(model.status.innerHTML, "");
  model.state.user.role = "member";
  assert.doesNotMatch(model.calendarShell(), /id="acting-controls"|id="acting-status"/);
});

test("administrator scheduling on behalf of a member", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-acting-for-"));
  let db, server;
  try {
    const filename = path.join(directory, "club.sqlite");
    db = openDatabase(filename, true);
    const password = "Fictional-acting-for-tests-12345";
    const add = (name, role = "member") => addMember(db, { name, email: `${name.replace(/\W/g, "")}@example.test`, password }, role);
    const adminId = add("QA Administrator", "admin");
    const targetId = add("QA Target <Member>");
    const otherId = add("QA Other");
    const thirdId = add("QA Third");
    const fourthId = add("QA Fourth");
    const inactiveId = add("QA Inactive");
    db.prepare("UPDATE members SET active=0 WHERE id=?").run(inactiveId);
    const guest = add("-Guest-"), standby = add("-Standby-"), unavailable = add("-Unavailable-");
    db.prepare("INSERT INTO metadata VALUES('preview','1')").run();
    server = createApp({ db, preview: true, previewToday: "2026-10-24" });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    async function req(route, method = "GET", body, token) {
      const response = await fetch(base + route, {
        method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() };
    }
    const login = async id => (await req("/api/login", "POST", { email: db.prepare("SELECT email FROM members WHERE id=?").get(id).email, password })).body.token;
    const admin = await login(adminId), member = await login(targetId);
    let nextDay = 1;
    const game = (type = "pairs", date = `2026-11-${String(nextDay++).padStart(2, "0")}`) =>
      Number(db.prepare("INSERT INTO games(date,time,name,event_type) VALUES(?,'11:30','Fictional QA',?)").run(date, type).lastInsertRowid);
    const entries = id => db.prepare("SELECT * FROM entries WHERE game_id=? ORDER BY member_id").all(id);
    const audits = () => db.prepare("SELECT * FROM registration_audit ORDER BY id").all();
    const snapshot = () => JSON.stringify(Object.fromEntries(["entries", "team_members", "members", "sessions", "registration_audit"].map(
      table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()])));
    const fields = async (id, target = targetId) => ({
      memberId: target, confirm: true, revision: (await req(`/api/games/${id}/manage`, "GET", undefined, admin)).body.revision
    });
    const act = async (id, method, extra = {}, target = targetId, suffix = "entry") =>
      req(`/api/games/${id}/${suffix}`, method, { ...await fields(id, target), ...extra }, admin);
    const seedPair = (id, first, second) => {
      db.prepare("INSERT INTO entries VALUES(?,?,?)").run(id, first, second);
      db.prepare("INSERT INTO entries VALUES(?,?,?)").run(id, second, first);
    };
    await t.test("ordinary members cannot forge delegation for any scheduling method", async () => {
      const id = game(), before = snapshot();
      for (const suffix of ["entry", "team"])
        for (const method of ["POST", "DELETE"]) {
          assert.equal((await req(`/api/games/${id}/${suffix}`, method,
            { ...await fields(id), partnerId: null }, member)).status, 403);
          assert.equal((await req(`/api/games/${id}/${suffix}`, method,
            { memberId: targetId, partnerId: null })).status, 401);
        }
      assert.equal(snapshot(), before);
    });
    await t.test("calendar retains the actor and supplies revisions only to administrators", async () => {
      const calendar = (await req("/api/calendar", "GET", undefined, admin)).body;
      assert.equal(calendar.user.id, adminId);
      assert.ok(Object.keys(calendar.registrationRevisions).length);
      assert.equal((await req("/api/calendar", "GET", undefined, member)).body.registrationRevisions, undefined);
      assert.equal(JSON.stringify(calendar).includes("password"), false);
    });
    await t.test("solo registration changes the target, not the administrator, with an atomic audit", async () => {
      const id = game();
      assert.equal((await act(id, "POST", { partnerId: null })).status, 200);
      assert.deepEqual(entries(id).map(row => row.member_id), [targetId]);
      const record = audits().at(-1);
      assert.equal(record.actor_id, adminId); assert.equal(record.target_id, targetId);
      assert.equal(record.target_name, "QA Target <Member>");
      assert.equal(record.action, "register"); assert.equal(record.game_id, id);
      assert.equal(JSON.parse(record.before_json).entries.length, 0);
      assert.equal(JSON.parse(record.after_json).entries[0].member_id, targetId);
      assert.equal(JSON.stringify(record).includes(password), false);
    });
    await t.test("real partner registration and cancellation preserve the former partner as a single", async () => {
      const id = game();
      assert.equal((await act(id, "POST", { partnerId: otherId })).status, 200);
      assert.equal(entries(id).length, 2);
      assert.equal((await act(id, "DELETE")).status, 200);
      assert.deepEqual(entries(id).map(row => [row.member_id, row.partner_id]), [[otherId, null]]);
      assert.equal(audits().at(-1).action, "cancel");
    });
    await t.test("guest, standby and unavailable remain overbookable one-directional assignments", async () => {
      for (const placeholder of [guest, standby, unavailable]) {
        const id = game();
        assert.equal((await act(id, "POST", { partnerId: placeholder })).status, 200);
        assert.equal((await act(id, "POST", { partnerId: placeholder }, otherId)).status, 200);
        assert.equal(entries(id).length, 2);
        assert.equal(entries(id).some(row => row.member_id === placeholder), false);
        assert.equal((await act(id, "DELETE")).status, 200);
        assert.equal(entries(id)[0].member_id, otherId);
      }
    });
    await t.test("invalid IDs, self-partnership, inactive and placeholder targets are rejected without writes", async () => {
      const id = game(), before = snapshot();
      for (const target of [null, "2", 0, -1, 1.5, 999999, inactiveId, guest, standby, unavailable]) {
        const result = await act(id, "POST", { partnerId: null }, target);
        assert.ok([400, 409].includes(result.status), JSON.stringify(target));
      }
      assert.equal((await act(id, "POST", { partnerId: targetId })).status, 400);
      assert.equal((await act(id, "POST", { partnerId: inactiveId })).status, 409);
      assert.equal(snapshot(), before);
    });
    await t.test("confirmation and current reviewed revision are required for delegation", async () => {
      const id = game(), before = snapshot();
      for (const confirm of [false, "true", 1, null])
        assert.equal((await act(id, "POST", { partnerId: null, confirm })).status, 400);
      assert.equal((await act(id, "POST", { partnerId: null, revision: undefined })).status, 409);
      assert.equal((await act(id, "DELETE", { revision: "stale" })).status, 409);
      assert.equal(snapshot(), before);
    });
    await t.test("concurrent registrations, game edits and teams invalidate a reviewed action", async () => {
      const id = game("teams"), reviewed = await fields(id);
      db.prepare("INSERT INTO entries VALUES(?,?,NULL)").run(id, thirdId);
      const before = snapshot();
      assert.equal((await req(`/api/games/${id}/entry`, "POST", { ...reviewed, partnerId: null }, admin)).status, 409);
      assert.equal(snapshot(), before);
      const second = await fields(id);
      db.prepare("UPDATE games SET time='12:00' WHERE id=?").run(id);
      assert.equal((await req(`/api/games/${id}/entry`, "DELETE", second, admin)).status, 409);
      const third = await fields(id);
      db.prepare("INSERT INTO team_members VALUES(?,?,'qa-stale-team')").run(id, thirdId);
      assert.equal((await req(`/api/games/${id}/entry`, "DELETE", third, admin)).status, 409);
    });
    await t.test("normal partnership restrictions remain enforced", async () => {
      const id = game(); seedPair(id, otherId, thirdId);
      const before = snapshot();
      assert.equal((await act(id, "POST", { partnerId: otherId })).status, 409);
      assert.equal(snapshot(), before);
      assert.equal((await act(id, "POST", { partnerId: fourthId })).status, 200);
      const paired = snapshot();
      assert.equal((await act(id, "POST", { partnerId: guest })).status, 409);
      assert.equal(snapshot(), paired);
    });
    await t.test("form and dissolve another member's team without adding the administrator", async () => {
      const id = game("teams"); seedPair(id, targetId, otherId); seedPair(id, thirdId, fourthId);
      assert.equal((await act(id, "POST", { pairMemberId: thirdId, pairPartnerId: fourthId, ownPartnerId: otherId }, targetId, "team")).status, 200);
      const team = db.prepare("SELECT * FROM team_members WHERE game_id=?").all(id);
      assert.equal(team.length, 4); assert.equal(team.some(row => row.member_id === adminId), false);
      assert.equal(audits().at(-1).action, "form-team");
      assert.equal((await act(id, "DELETE", { teamId: team[0].team_id }, targetId, "team")).status, 200);
      assert.equal(entries(id).length, 4); assert.equal(audits().at(-1).action, "leave-team");
    });
    await t.test("cancelling a team member dissolves the team and leaves the other pair intact", async () => {
      const id = game("teams"); seedPair(id, targetId, otherId); seedPair(id, thirdId, fourthId);
      await act(id, "POST", { pairMemberId: thirdId, pairPartnerId: fourthId, ownPartnerId: otherId }, targetId, "team");
      assert.equal((await act(id, "DELETE")).status, 200);
      assert.equal(db.prepare("SELECT count(*) AS n FROM team_members WHERE game_id=?").get(id).n, 0);
      assert.equal(entries(id).find(row => row.member_id === otherId).partner_id, null);
      assert.equal(entries(id).find(row => row.member_id === thirdId).partner_id, fourthId);
      assert.equal(JSON.parse(audits().at(-1).before_json).teams.length, 4);
    });
    await t.test("two guest pairs form a team; standby and unavailable cannot", async () => {
      const id = game("teams");
      await act(id, "POST", { partnerId: guest });
      await act(id, "POST", { partnerId: guest }, otherId);
      assert.equal((await act(id, "POST", { pairMemberId: otherId, pairPartnerId: guest, ownPartnerId: guest }, targetId, "team")).status, 200);
      assert.equal(db.prepare("SELECT count(*) AS n FROM team_members WHERE game_id=?").get(id).n, 2);
      for (const placeholder of [standby, unavailable]) {
        const blocked = game("teams"); seedPair(blocked, thirdId, fourthId);
        await act(blocked, "POST", { partnerId: placeholder });
        const before = snapshot();
        assert.equal((await act(blocked, "POST", { pairMemberId: thirdId, pairPartnerId: fourthId, ownPartnerId: placeholder }, targetId, "team")).status, 409);
        assert.equal(snapshot(), before);
      }
    });
    await t.test("past and missing games remain closed to administrator delegation", async () => {
      const id = game("pairs", "2026-10-23"), before = snapshot();
      for (const method of ["POST", "DELETE"]) {
        assert.equal((await req(`/api/games/${id}/entry`, method, { memberId: targetId, partnerId: null, confirm: true, revision: "old" }, admin)).status, 409);
        assert.equal((await req("/api/games/999999/entry", method, { memberId: targetId, partnerId: null, confirm: true }, admin)).status, 404);
      }
      assert.equal(snapshot(), before);
    });
    await t.test("audit insertion failure rolls back the entire scheduling action", async () => {
      const id = game(), before = snapshot();
      db.exec("CREATE TRIGGER qa_refuse_audit BEFORE INSERT ON registration_audit BEGIN SELECT RAISE(ABORT,'QA audit failure'); END");
      try {
        assert.equal((await act(id, "POST", { partnerId: otherId })).status, 500);
        assert.equal(snapshot(), before);
      } finally { db.exec("DROP TRIGGER qa_refuse_audit"); }
    });
    await t.test("deleting a game preserves administrator scheduling audit history", async () => {
      const id = game(); await act(id, "POST", { partnerId: null });
      const before = audits();
      const plan = (await req(`/api/games/${id}/manage`, "GET", undefined, admin)).body;
      assert.equal((await req(`/api/games/${id}/manage`, "DELETE", { revision: plan.revision, confirm: true }, admin)).status, 200);
      assert.deepEqual(audits(), before);
    });
    await t.test("self-service remains unaudited and other account/session identities do not change", async () => {
      const id = game(), before = audits().length;
      const accounts = JSON.stringify(db.prepare("SELECT * FROM members ORDER BY id").all());
      const sessions = JSON.stringify(db.prepare("SELECT * FROM sessions ORDER BY hash").all());
      assert.equal((await req(`/api/games/${id}/entry`, "POST", { partnerId: null }, member)).status, 200);
      assert.equal(entries(id)[0].member_id, targetId);
      assert.equal(audits().length, before);
      assert.equal(JSON.stringify(db.prepare("SELECT * FROM members ORDER BY id").all()), accounts);
      assert.equal(JSON.stringify(db.prepare("SELECT * FROM sessions ORDER BY hash").all()), sessions);
    });
    await t.test("expired and demoted administrator sessions cannot act for another member", async () => {
      const id = game(), expired = await login(adminId);
      db.prepare("UPDATE sessions SET expires=0 WHERE hash=?").run(hashToken(expired));
      assert.equal((await req(`/api/games/${id}/entry`, "POST", { ...await fields(id), partnerId: null }, expired)).status, 401);
      const secondAdmin = add("QA Other Admin", "admin"), secondToken = await login(secondAdmin);
      db.prepare("UPDATE members SET role='member' WHERE id=?").run(secondAdmin);
      const before = snapshot();
      assert.equal((await req(`/api/games/${id}/entry`, "POST", { ...await fields(id), partnerId: null }, secondToken)).status, 403);
      assert.equal(snapshot(), before);
    });
    await t.test("repeatable additive migration preserves all records, audit history and baseline version", () => {
      const before = snapshot(), first = migrateRegistrationAudit(filename), second = migrateRegistrationAudit(filename);
      assert.equal(first.applied, false); assert.equal(second.applied, false);
      assert.deepEqual(first.before, first.after); assert.equal(snapshot(), before);
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
      assert.throws(() => migrateRegistrationAudit(path.join(directory, "missing.sqlite")), /not found/);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    });
  } finally {
    if (server) { server.close(); await once(server, "close"); }
    db?.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy installation requires explicit audit migration, not startup writes", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-acting-migration-"));
  let db, server;
  try {
    const filename = path.join(directory, "legacy.sqlite");
    db = openDatabase(filename, true);
    // Empty synthetic fixture models the preceding release, never a real database.
    db.exec("DROP TABLE registration_audit");
    const password = "Fictional-migration-test-12345";
    const actor = addMember(db, { name: "QA Admin", email: "admin@example.test", password }, "admin");
    const target = addMember(db, { name: "QA Member", email: "member@example.test", password });
    db.prepare("INSERT INTO games(date,time) VALUES('2099-01-01','11:30')").run();
    server = createApp({ db }); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = (await (await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.test", password }) })).json()).token;
    const response = await fetch(base + "/api/games/1/entry", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ memberId: target, partnerId: null, confirm: true }) });
    assert.equal(response.status, 503);
    assert.equal(db.prepare("SELECT count(*) AS n FROM entries").get().n, 0);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='registration_audit'").get(), undefined);
    const result = migrateRegistrationAudit(filename);
    assert.equal(result.applied, true); assert.deepEqual(result.before, result.after);
    assert.equal(db.prepare("SELECT count(*) AS n FROM registration_audit").get().n, 0);
    assert.equal(db.prepare("SELECT role FROM members WHERE id=?").get(actor).role, "admin");
  } finally {
    if (server) { server.close(); await once(server, "close"); }
    db?.close(); rmSync(directory, { recursive: true, force: true });
  }
});
