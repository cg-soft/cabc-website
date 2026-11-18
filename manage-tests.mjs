import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { backup } from "node:sqlite";
import { ROOT, openDatabase, addMember, passwordMatches, hashToken } from "./db.mjs";
import { createApp } from "./server.mjs";

// Simulate TTY capability only in the child test process; feed answers after prompts.
function run(filename, command, answers = [], interactive = true, onPrompt = () => {}, commandArgs = []) {
  return new Promise((resolve, reject) => {
    const args = interactive
      ? ["--import", "data:text/javascript,Object.defineProperty(process.stdin,'isTTY',{value:true})"]
      : [];
    const child = spawn(process.execPath, [...args, "manage.mjs", command, ...commandArgs], {
      cwd: ROOT, env: { ...process.env, DB_PATH: filename },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "", next = 0;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Management command timed out")); }, 10000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.stdout.on("data", data => {
      output += data;
      if (/(Email|Name|Email to keep|Duplicate email to retire): |Type (DEMOTE|MERGE).*: /.test(String(data)) && next < answers.length) {
        onPrompt(String(data));
        child.stdin.write(answers[next++] + "\n");
      }
    });
    child.stderr.on("data", data => { output += data; });
    child.on("close", code => { clearTimeout(timer); resolve({ code, output }); });
    if (!interactive) child.stdin.end();
  });
}

test("operator-only member merge on a SQLite copy", async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cabc-merge-"));
  const source = path.join(directory, "source.sqlite"), copy = path.join(directory, "copy.sqlite");
  const password = "Fictional-merge-test-12345";
  const original = openDatabase(source, true);
  let db;
  t.after(() => { db?.close(); original.close(); rmSync(directory, { recursive: true, force: true }); });
  const member = (name, email, role) => addMember(original, { name, email: `${email}@example.test`, password }, role);
  const keep = member("Duplicate Person", "keep"), retire = member("Duplicate Person", "retire", "admin");
  const otherAdmin = member("Another Admin", "admin", "admin");
  const a = member("Partner", "partner"), b = member("Team Player One", "one"), c = member("Team Player Two", "two");
  const guest = member("-Guest-", "guest"), standby = member("-Standby-", "standby");
  const game = original.prepare("INSERT INTO games(id,date,event_type) VALUES(?,?,?)");
  game.run(1, "2024-01-01", "teams"); game.run(2, "2099-01-02", "pairs");
  game.run(3, "2099-01-03", "pairs"); game.run(4, "2099-01-04", "pairs");
  const entry = original.prepare("INSERT INTO entries VALUES(?,?,?)");
  for (const [id, partner] of [[retire,a],[a,retire],[b,c],[c,b]]) {
    entry.run(1,id,partner);
    original.prepare("INSERT INTO team_members VALUES(1,?,'intact-team')").run(id);
  }
  entry.run(2,retire,guest); entry.run(3,retire,standby); entry.run(3,keep,standby); entry.run(4,retire,null);
  const session = original.prepare("INSERT INTO sessions VALUES(?,?,?)");
  session.run("retire-session",retire,4000000000000); session.run("keep-session",keep,4000000000000);
  original.prepare("INSERT INTO notification_preferences VALUES(?,0,'keep-optout','2026-01-01')").run(keep);
  const notification = original.prepare("INSERT INTO notification_outbox(id,event_id,member_id,email,payload_json,state,created_at,next_attempt) VALUES(?,?,?,?, '{}',?,1,1)");
  notification.run("retired-pending","e1",retire,"retire@example.test","pending");
  notification.run("retired-sent","e2",retire,"retire@example.test","sent");
  notification.run("kept-pending","e1",keep,"keep@example.test","pending");
  original.prepare(`INSERT INTO registration_audit VALUES
    (1,'2024-01-01',?,'Historical actor',?,'Historical target',1,'2024-01-01','register','{}','{}')`).run(retire,retire);
  const bytes = Buffer.from("%PDF-1.4\n%%EOF\n");
  original.prepare(`INSERT INTO documents(title,filename,content,size,uploaded_by,created_at,updated_at)
    VALUES('Historical upload','test.pdf',?,?,?,'2024-01-01','2024-01-01')`).run(bytes,bytes.length,retire);
  const snapshot = connection => Object.fromEntries(["members","games","entries","team_members","sessions","registration_audit",
    "documents","document_audit","notification_preferences","notification_outbox"].map(table =>
    [table,connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const unchanged = snapshot(original);
  await backup(original, copy);
  db = openDatabase(copy);
  const answers = [" KEEP@EXAMPLE.TEST ", "retire@example.test"];
  const invoke = (more = [], args = [], onPrompt) => run(copy, "merge-member", [...answers,...more], true, onPrompt, args);
  const checkUnchanged = async (promise, pattern, code = 1) => {
    const before = snapshot(db);
    const result = await promise();
    assert.equal(result.code,code,result.output);
    assert.match(result.output,pattern);
    assert.deepEqual(snapshot(db),before);
  };
  await t.test("dry-run and cancellation write nothing", async () => {
    await checkUnchanged(() => invoke([],["--dry-run"]), /2024-01-01:.*keep intact team[\s\S]*2099-01-03: combine identical registrations[\s\S]*Dry run/, 0);
    await checkUnchanged(() => invoke(["merge"]), /Merge cancelled/);
    await checkUnchanged(() => run(copy,"merge-member",[],false), /interactive terminal/);
    await checkUnchanged(() => run(copy,"merge-member",["keep@example.test","keep@example.test"]), /two different accounts/);
    await checkUnchanged(() => run(copy,"merge-member",["keep@example.test","guest@example.test"]), /Placeholder accounts/);
  });
  await t.test("same-day conflict reports the date and never moves even earlier games", async () => {
    db.prepare("INSERT INTO entries VALUES(?,?,NULL)").run(2,keep);
    try { await checkUnchanged(() => invoke(["MERGE"]), /2099-01-02: both accounts/); }
    finally { db.prepare("DELETE FROM entries WHERE game_id=2 AND member_id=?").run(keep); }
  });
  await t.test("self-pair, last administrator and in-flight mail are blocked", async () => {
    db.prepare("UPDATE entries SET partner_id=? WHERE game_id=4 AND member_id=?").run(keep,retire);
    db.prepare("INSERT INTO entries VALUES(4,?,?)").run(keep,retire);
    await checkUnchanged(() => invoke(), /2099-01-04: the two accounts are paired/);
    db.prepare("DELETE FROM entries WHERE game_id=4 AND member_id=?").run(keep);
    db.prepare("UPDATE entries SET partner_id=NULL WHERE game_id=4 AND member_id=?").run(retire);
    db.prepare("UPDATE members SET role='member' WHERE id=?").run(otherAdmin);
    await checkUnchanged(() => invoke(), /last active administrator/);
    db.prepare("UPDATE members SET role='admin' WHERE id=?").run(otherAdmin);
    db.exec("UPDATE notification_outbox SET state='sending' WHERE id='retired-pending'");
    await checkUnchanged(() => invoke(), /in flight/);
    db.exec("UPDATE notification_outbox SET state='pending' WHERE id='retired-pending'");
  });
  await t.test("changed review and a late write failure cannot partially merge", async () => {
    const review = await invoke(["MERGE"],[],prompt => {
      if (prompt.startsWith("Type MERGE")) db.exec("UPDATE games SET name='Changed during review' WHERE id=1");
    });
    assert.equal(review.code,1,review.output);
    assert.match(review.output,/changed.*review the new plan/);
    db.exec("UPDATE games SET name='' WHERE id=1");
    db.exec(`CREATE TRIGGER fail_merge BEFORE UPDATE ON notification_outbox
      WHEN NEW.state='skipped' BEGIN SELECT RAISE(ABORT,'fixture merge failure'); END`);
    try { await checkUnchanged(() => invoke(["MERGE"]), /fixture merge failure/); }
    finally { db.exec("DROP TRIGGER fail_merge"); }
  });
  await t.test("confirmed merge preserves pairs, team, kept login, and audit history", async () => {
    const before = snapshot(db);
    const result = await invoke(["MERGE"]);
    assert.equal(result.code,0,result.output);
    assert.match(result.output,/Merge complete/);
    const after = snapshot(db);
    assert.deepEqual(after.members.find(row => row.id === keep),before.members.find(row => row.id === keep));
    assert.equal(after.members.find(row => row.id === retire).active,0);
    assert.deepEqual(after.sessions.map(row => row.hash),["keep-session"]);
    assert.deepEqual(after.entries.filter(row => row.member_id === keep).sort((x,y) => x.game_id-y.game_id)
      .map(row => row.partner_id),[a,guest,standby,null]);
    assert.ok(after.entries.some(row => row.game_id === 1 && row.member_id === a && row.partner_id === keep));
    assert.ok(after.entries.every(row => row.member_id !== retire && row.partner_id !== retire));
    assert.deepEqual(after.team_members.map(row => row.member_id).sort((x,y) => x-y),[keep,a,b,c]);
    assert.ok(after.team_members.every(row => row.team_id === "intact-team"));
    assert.deepEqual(after.notification_outbox.map(row => [row.id,row.state]),
      [["retired-pending","skipped"],["retired-sent","sent"],["kept-pending","pending"]]);
    for (const table of ["registration_audit","document_audit","documents","notification_preferences","games"])
      assert.deepEqual(after[table],before[table]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    assert.deepEqual(snapshot(original),unchanged);
    await checkUnchanged(() => invoke(["MERGE"]), /Inactive accounts require manual review/);
  });
});

test("operator-only demotion command", async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cabc-demote-"));
  const filename = path.join(directory, "club.sqlite");
  const password = "Fictional-demotion-test-12345";
  await t.test("missing database is never initialized", async () => {
    const result = await run(filename, "demote");
    assert.equal(result.code, 1); assert.match(result.output, /not initialized/);
    assert.equal(existsSync(filename), false);
  });
  let db = openDatabase(filename, true);
  const ids = {};
  for (const [name, role] of [["Owner", "admin"], ["Target", "admin"], ["Member", "member"],
    ["Partner", "member"], ["Inactive", "admin"], ["-Guest-", "admin"]])
    ids[name] = addMember(db, { name, email: `${name === "-Guest-" ? "guest" : name.toLowerCase()}@example.test`, password }, role);
  db.prepare("UPDATE members SET active=0 WHERE id=?").run(ids.Inactive);
  db.prepare("INSERT INTO games(id,date,time,event_type) VALUES(1,'2099-12-01','11:30','teams')").run();
  for (const [id, partner] of [[ids.Owner, ids.Target], [ids.Target, ids.Owner],
    [ids.Member, ids.Partner], [ids.Partner, ids.Member]]) {
    db.prepare("INSERT INTO entries VALUES(1,?,?)").run(id, partner);
    db.prepare("INSERT INTO team_members VALUES(1,?,'demotion-team')").run(id);
  }
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
  db.prepare("INSERT INTO documents(title,filename,content,size,uploaded_by,created_at,updated_at) VALUES('Private','private.pdf',?,?,?,'2026-01-01','2026-01-01')")
    .run(pdf, pdf.length, ids.Target);
  db.prepare("INSERT INTO notification_preferences VALUES(?,0,'demotion-token','2026-01-01')").run(ids.Target);
  for (const [token, id] of [["a", ids.Owner], ["b", ids.Target], ["c", ids.Target], ["d", ids.Member]])
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hashToken(token.repeat(64)), id, Date.now() + 30 * 86400000);
  const snapshot = () => Object.fromEntries(["members", "games", "entries", "team_members", "documents",
    "document_audit", "notification_preferences", "notification_outbox", "sessions"].map(table =>
    [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const server = createApp({ db });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (route, token, body, extra = {}) => fetch(base + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    db.close(); rmSync(directory, { recursive: true, force: true });
  });
  await t.test("noninteractive, missing, blank, placeholder and injected targets are unchanged", async () => {
    const before = snapshot();
    assert.equal((await run(filename, "demote", [], false)).code, 1);
    for (const email of ["absent@example.test", "", "' OR 1=1 --", "guest@example.test"])
      assert.equal((await run(filename, "demote", [email])).code, 1);
    assert.deepEqual(snapshot(), before);
  });
  await t.test("regular members are idempotent and explicit confirmation is required", async () => {
    const before = snapshot();
    const regular = await run(filename, "demote", ["member@example.test"]);
    assert.equal(regular.code, 0); assert.match(regular.output, /already a regular member/);
    for (const answer of ["", "no", "demote"])
      assert.equal((await run(filename, "demote", ["target@example.test", answer])).code, 1);
    assert.deepEqual(snapshot(), before);
  });
  await t.test("stale account review is rejected under the write lock", async () => {
    const result = await run(filename, "demote", ["target@example.test", "DEMOTE"], true, prompt => {
      if (prompt.startsWith("Type DEMOTE")) db.prepare("UPDATE members SET name='Renamed Target' WHERE id=?").run(ids.Target);
    });
    assert.equal(result.code, 1); assert.match(result.output, /account changed/);
    assert.equal(db.prepare("SELECT role FROM members WHERE id=?").get(ids.Target).role, "admin");
    db.prepare("UPDATE members SET name='Target' WHERE id=?").run(ids.Target);
  });
  await t.test("session-revocation failure rolls back the demotion", async () => {
    const before = snapshot();
    db.exec(`CREATE TRIGGER fail_demote_sessions BEFORE DELETE ON sessions
      WHEN OLD.member_id=${ids.Target} BEGIN SELECT RAISE(ABORT,'fixture failure'); END`);
    try {
      assert.equal((await run(filename, "demote", ["target@example.test", "DEMOTE"])).code, 1);
      assert.deepEqual(snapshot(), before);
    } finally { db.exec("DROP TRIGGER fail_demote_sessions"); }
  });
  await t.test("neither browser role has a demotion endpoint or UI", async () => {
    const before = snapshot();
    const app = readFileSync(path.join(ROOT, "public/app.js"), "utf8");
    assert.doesNotMatch(app, /Manage administrator access|administrator-access-form|manage-administrator-access/);
    for (const token of ["a", "d"]) {
      const response = await request(`/members/${ids.Target}/administrator-access`, token.repeat(64),
        { action: "remove", confirm: true, currentPassword: password, role: "member" });
      assert.equal(response.status, 404);
    }
    assert.deepEqual(snapshot(), before);
  });
  await t.test("confirmed demotion changes only the role and target sessions", async () => {
    const before = snapshot();
    const result = await run(filename, "demote", [" TARGET@EXAMPLE.TEST ", "DEMOTE"]);
    assert.equal(result.code, 0); assert.match(result.output, /Selected administrator: Target/);
    assert.match(result.output, /Administrator access removed from Target/);
    assert.doesNotMatch(result.output, /Generated password|Fictional-demotion/);
    before.members.find(member => member.id === ids.Target).role = "member";
    before.sessions = before.sessions.filter(session => session.member_id !== ids.Target);
    assert.deepEqual(snapshot(), before);
    assert.equal((await request("/calendar", "b".repeat(64))).status, 401);
    assert.equal((await request("/session", null, undefined, { Cookie: `__Host-cabc_session=${"c".repeat(64)}` })).status, 401);
    assert.equal((await request("/members/manage", "a".repeat(64))).status, 200);
    const login = await request("/login", null, { email: "target@example.test", password });
    assert.equal(login.status, 200);
    const session = await login.json();
    assert.equal(session.member.role, "member");
    assert.equal((await request("/members/manage", session.token)).status, 403);
    const reopened = openDatabase(filename);
    try { assert.equal(reopened.prepare("SELECT role FROM members WHERE id=?").get(ids.Target).role, "member"); }
    finally { reopened.close(); }
  });
  await t.test("last active real admin is protected even with inactive and placeholder admins", async () => {
    const before = snapshot();
    const result = await run(filename, "demote", ["owner@example.test", "DEMOTE"]);
    assert.equal(result.code, 1); assert.match(result.output, /last active administrator/);
    assert.deepEqual(snapshot(), before);
  });
  await t.test("inactive admin can lose role without being reactivated", async () => {
    const result = await run(filename, "demote", ["inactive@example.test", "DEMOTE"]);
    assert.equal(result.code, 0);
    const member = db.prepare("SELECT role,active FROM members WHERE id=?").get(ids.Inactive);
    assert.equal(member.role, "member"); assert.equal(member.active, 0);
  });
  await t.test("concurrent commands cannot demote both remaining real admins", async () => {
    db.prepare("UPDATE members SET role='admin' WHERE id=?").run(ids.Target);
    const results = await Promise.all([
      run(filename, "demote", ["owner@example.test", "DEMOTE"]),
      run(filename, "demote", ["target@example.test", "DEMOTE"])
    ]);
    assert.equal(results.filter(result => result.code === 0).length, 1);
    assert.equal(results.filter(result => /last active administrator/.test(result.output)).length, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM members WHERE active=1 AND role='admin' AND id IN (?,?)")
      .get(ids.Owner, ids.Target).n, 1);
  });
  await t.test("usage lists both operator-only role commands", async () => {
    assert.match((await run(filename, "unknown")).output, /Usage:.*promote.*demote/);
  });
});

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
