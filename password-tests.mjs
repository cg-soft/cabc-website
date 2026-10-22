import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { openDatabase, addMember, passwordMatches, hashToken } from "./db.mjs";
import { createApp } from "./server.mjs";

test("signed-in password changes", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-password-"));
  const file = path.join(directory, "club.sqlite");
  let db, server;
  try {
    db = openDatabase(file, true);
    const oldPassword = "Original-test-password-12345";
    const memberId = addMember(db, { name: "Member", email: "member@example.test", password: oldPassword });
    const adminId = addMember(db, { name: "Admin", email: "admin@example.test", password: oldPassword }, "admin");
    const limitedId = addMember(db, { name: "Limited", email: "limited@example.test", password: oldPassword });
    db.exec("INSERT INTO games(id,date,time,name) VALUES(1,'2098-11-01','11:30','Preserved game')");
    db.prepare("INSERT INTO entries VALUES(1,?,?)").run(memberId, adminId);
    db.prepare("INSERT INTO entries VALUES(1,?,?)").run(adminId, memberId);
    const entriesBefore = db.prepare("SELECT * FROM entries ORDER BY member_id").all();
    server = createApp({ db }); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    async function req(route, token, body, method = body ? "POST" : "GET") {
      const response = await fetch(base + route, { method, headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {})
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    }
    const login = (email, password = oldPassword) => req("/api/login", null, { email, password });
    const data = (current = oldPassword, next = "Replacement-test-password-67890") =>
      ({ currentPassword: current, newPassword: next, confirmPassword: next });
    const first = (await login("member@example.test")).body.token;
    const second = (await login("member@example.test")).body.token;
    const owner = (await login("admin@example.test")).body.token;
    const limited = (await login("limited@example.test")).body.token;
    let memberToken, memberPassword = "Replacement-test-password-67890";
    await t.test("anonymous, invalid and expired sessions cannot change passwords", async () => {
      assert.equal((await req("/api/password", null, data())).status, 401);
      assert.equal((await req("/api/password", "invalid", data())).status, 401);
      const expired = (await login("member@example.test")).body.token;
      db.prepare("UPDATE sessions SET expires=0 WHERE hash=?").run(hashToken(expired));
      assert.equal((await req("/api/password", expired, data())).status, 401);
    });
    await t.test("invalid fields, short/overlong passwords, mismatches and reuse are rejected", async () => {
      const cases = [
        {}, { ...data(), currentPassword: [] }, { ...data(), currentPassword: "x".repeat(129) },
        data(oldPassword, "short"), data(oldPassword, "x".repeat(129)),
        { ...data(), newPassword: 123456789012 }, { ...data(), confirmPassword: "different" },
        data(oldPassword, oldPassword)
      ];
      for (const body of cases) assert.equal((await req("/api/password", first, body)).status, 400);
      assert.equal((await req("/api/calendar", first)).status, 200);
      assert.ok(passwordMatches(oldPassword, db.prepare("SELECT password FROM members WHERE id=?").get(memberId).password));
      const notJson = await fetch(base + "/api/password", { method: "POST", headers: { Authorization: `Bearer ${first}`, "Content-Type": "text/plain" }, body: JSON.stringify(data()) });
      assert.equal(notJson.status, 415);
    });
    await t.test("wrong current password gives an inline-compatible 400, preserving all sessions", async () => {
      const result = await req("/api/password", first, data("Wrong-current-password"));
      assert.equal(result.status, 400); assert.equal(result.body.error, "Your current password is incorrect.");
      assert.equal((await req("/api/calendar", first)).status, 200);
      assert.equal((await req("/api/calendar", second)).status, 200);
    });
    await t.test("successful self-change hashes the new password and revokes all own sessions only", async () => {
      const hashBefore = db.prepare("SELECT password FROM members WHERE id=?").get(memberId).password;
      const otherBefore = db.prepare("SELECT * FROM members WHERE id=?").get(adminId);
      const result = await req("/api/password", first, { ...data(), memberId: adminId, email: "admin@example.test", role: "admin" });
      assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true });
      const member = db.prepare("SELECT * FROM members WHERE id=?").get(memberId);
      assert.equal(member.role, "member");
      assert.notEqual(member.password, hashBefore);
      assert.notEqual(member.password, memberPassword);
      assert.ok(passwordMatches(memberPassword, member.password));
      assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE member_id=?").get(memberId).n, 0);
      assert.equal((await req("/api/calendar", first)).status, 401);
      assert.equal((await req("/api/calendar", second)).status, 401);
      assert.equal((await req("/api/calendar", owner)).status, 200);
      assert.deepEqual(db.prepare("SELECT * FROM members WHERE id=?").get(adminId), otherBefore);
      assert.deepEqual(db.prepare("SELECT * FROM entries ORDER BY member_id").all(), entriesBefore);
      assert.equal((await login("member@example.test")).status, 401);
      const logged = await login("member@example.test", memberPassword);
      assert.equal(logged.status, 200); memberToken = logged.body.token;
    });
    await t.test("administrator accounts can change their own password and retain their role", async () => {
      assert.equal((await req("/api/password", owner, data(oldPassword, "New-admin-password-67890"))).status, 200);
      assert.equal((await req("/api/calendar", owner)).status, 401);
      const logged = await login("admin@example.test", "New-admin-password-67890");
      assert.equal(logged.status, 200); assert.equal(logged.body.member.role, "admin");
    });
    await t.test("the 12 and 128 character boundaries work without truncation", async () => {
      for (const next of ["a".repeat(12), "z".repeat(128)]) {
        assert.equal((await req("/api/password", memberToken, data(memberPassword, next))).status, 200);
        memberPassword = next;
        const logged = await login("member@example.test", memberPassword);
        assert.equal(logged.status, 200); memberToken = logged.body.token;
      }
    });
    await t.test("password update and session revocation roll back together on database failure", async () => {
      const before = db.prepare("SELECT password FROM members WHERE id=?").get(memberId).password;
      db.exec(`CREATE TEMP TRIGGER fail_password_session_delete BEFORE DELETE ON sessions WHEN OLD.member_id=${memberId} BEGIN SELECT RAISE(ABORT,'test failure'); END`);
      try {
        const result = await req("/api/password", memberToken, data(memberPassword, "Must-not-be-saved-12345"));
        assert.equal(result.status, 500);
        assert.equal(db.prepare("SELECT password FROM members WHERE id=?").get(memberId).password, before);
        assert.equal((await req("/api/calendar", memberToken)).status, 200);
        assert.ok(!JSON.stringify(result.body).includes(memberPassword));
      } finally { db.exec("DROP TRIGGER fail_password_session_delete"); }
    });
    await t.test("five failed attempts throttle only that member and expire after fifteen minutes", async () => {
      for (let i = 0; i < 5; i++)
        assert.equal((await req("/api/password", limited, data("Wrong-current-password"))).status, 400);
      assert.equal((await req("/api/password", limited, data())).status, 429);
      assert.equal((await req("/api/calendar", memberToken)).status, 200);
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 15 * 60000 + 1;
        assert.equal((await req("/api/password", limited, data(oldPassword, "New-limited-password-12345"))).status, 200);
      } finally { Date.now = realNow; }
      assert.ok(passwordMatches("New-limited-password-12345", db.prepare("SELECT password FROM members WHERE id=?").get(limitedId).password));
    });
    await t.test("competing changes cannot both succeed with the old credentials", async () => {
      const a = req("/api/password", memberToken, data(memberPassword, "Race-first-password-12345"));
      const b = req("/api/password", memberToken, data(memberPassword, "Race-second-password-12345"));
      const responses = await Promise.all([a, b]);
      assert.equal(responses.filter(result => result.status === 200).length, 1);
      assert.ok(responses.some(result => [400, 401, 409].includes(result.status)));
      memberPassword = responses[0].status === 200 ? "Race-first-password-12345" : "Race-second-password-12345";
    });
    await t.test("password and unchanged registration records survive reopening the database", async () => {
      await new Promise(resolve => server.close(resolve)); server = undefined;
      db.close(); db = openDatabase(file);
      assert.ok(passwordMatches(memberPassword, db.prepare("SELECT password FROM members WHERE id=?").get(memberId).password));
      assert.deepEqual(db.prepare("SELECT * FROM entries ORDER BY member_id").all(), entriesBefore);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close(); rmSync(directory, { recursive: true, force: true });
  }
});
