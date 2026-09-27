/** Run: NODE_ENV=test npx tsx --test tests/backend-test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { DatabaseStorage, hashSecret, SESSION_MS, INVITE_MS, RESET_MS } from "../server/storage";
import { createApplication } from "../server/index";
import { migrateDatabase } from "../server/migrations";

if (process.env.NODE_ENV !== "test")
  throw new Error("Run with NODE_ENV=test to prevent starting the live server.");
const temp = mkdtempSync(path.join(os.tmpdir(), "bridge-club-backend-test-"));
const dbPath = path.join(temp, "club.sqlite"),
  setupPath = path.join(temp, "owner-setup.txt");
const password = "test-only-long-passphrase-76!";
const newPassword = "new-test-only-passphrase-85!";
const base = "http://127.0.0.1:5001";
const outcomes: { test: string; passed: boolean }[] = [];

test("invite-only backend security and full member lifecycle (isolated port 5001)", async (t) => {
  migrateDatabase(dbPath, { initialize: true });
  let store = new DatabaseStorage(dbPath, setupPath);
  let { httpServer } = await createApplication({ storage: store, apiOnly: true });
  httpServer.listen(5001, "127.0.0.1");
  await once(httpServer, "listening");
  let ownerToken = "",
    memberToken = "",
    recoveryToken = "";
  let ownerId = 0,
    memberId = 0,
    recoveryId = 0,
    publicEventId = 0,
    privateEventId = 0,
    docId = 0;
  let invite = "";
  const code = readFileSync(setupPath, "utf8").trim();
  const request = async (
    method: string,
    endpoint: string,
    body?: unknown,
    token?: string,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(base + endpoint, {
      method,
      headers: {
        Connection: "close",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
      text,
    };
  };
  const check = async (name: string, fn: () => Promise<void> | void) => {
    await t.test(name, async () => {
      await fn();
      outcomes.push({ test: name, passed: true });
    });
  };
  const ownerInput = { code, name: "Isolated Test Owner", email: "owner@example.test", password };
  const memberInput = { name: "Isolated Test Member", email: "member@example.test", password };
  const allPrivate: [string, string, unknown?][] = [
    ["GET", "/api/member/hub"],
    ["PATCH", "/api/member/profile", { name: "n", bio: "", listed: false }],
    ["POST", "/api/member/events/1/rsvp", { attending: true }],
    ["GET", "/api/member/documents/1"],
    ["GET", "/api/admin"],
    ["POST", "/api/admin/invites", { email: "x@example.test" }],
    ["POST", "/api/admin/reset", { email: "x@example.test" }],
    ["POST", "/api/admin/events", {}],
    ["POST", "/api/admin/announcements", {}],
    ["POST", "/api/admin/documents", {}],
    ["PATCH", "/api/admin/settings", {}],
  ];
  try {
    await check(
      "blank DB has only safe public settings and a private mode-600 bootstrap",
      async () => {
        assert.match(code, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(statSync(setupPath).mode & 0o777, 0o600);
        assert.equal(statSync(dbPath).mode & 0o777, 0o600);
        assert.equal((await request("GET", "/api/auth/status")).body.setupRequired, true);
        const response = await request("GET", "/api/public");
        assert.equal(response.status, 200);
        assert.deepEqual(response.body.events, []);
        assert.equal(response.body.settings.venue, "");
        assert.equal(response.body.settings.contactEmail, "");
        assert.equal(response.body.settings.scheduleNote, "Game dates will be announced here.");
        assert.deepEqual(Object.keys(response.body).sort(), ["events", "settings"]);
        assert.equal(store.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
        const boot = store.sqlite.prepare("SELECT * FROM bootstrap").get();
        assert.equal(boot.code_hash, hashSecret(code));
        assert.notEqual(boot.code_hash, code);
      },
    );
    await check(
      "every member/admin endpoint rejects anonymous and forged identity headers",
      async () => {
        for (const [method, endpoint, body] of allPrivate) {
          assert.equal((await request(method, endpoint, body)).status, 401, endpoint);
          assert.equal(
            (
              await request(method, endpoint, body, "A".repeat(43), {
                "X-Visitor-Id": "admin",
                "X-User-Role": "admin",
                Cookie: "role=admin",
                "X-Forwarded-For": "1.2.3.4",
              })
            ).status,
            401,
            endpoint,
          );
        }
        assert.equal((await request("POST", "/api/auth/logout", {})).status, 401);
        assert.equal((await request("GET", "/api/member/future-route")).status, 401);
        assert.equal((await request("GET", "/api/admin/future-route")).status, 401);
        assert.equal((await request("GET", "/api/member/hub?token=" + "A".repeat(43))).status, 401);
      },
    );
    await check(
      "opaque preview CORS permits Authorization but never credentials or caching",
      async () => {
        const preflight = await request("OPTIONS", "/api/member/hub", undefined, undefined, {
          Origin: "null",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization,content-type",
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
        assert.match(preflight.headers.get("access-control-allow-headers")!, /Authorization/);
        assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
        const pub = await request("GET", "/api/public");
        assert.match(pub.headers.get("cache-control")!, /no-store/);
        assert.equal(pub.headers.get("set-cookie"), null);
        assert.equal(pub.headers.get("x-powered-by"), null);
      },
    );
    await check("private files and unknown API paths are never static downloads", async () => {
      for (const p of [
        "/private/owner-setup.txt",
        "/data/club.sqlite",
        "/data/club.sqlite-wal",
        "/.env",
        "/server/storage.ts",
        "/shared/schema.ts",
        "/@fs" + setupPath,
        "/%70rivate/owner-setup.txt",
        "/%2570rivate/owner-setup.txt",
      ]) {
        const res = await request("GET", p);
        assert.equal(res.status, 404, p);
        assert.ok(!res.text.includes(code));
      }
      assert.equal((await request("GET", "/api/not-a-route")).status, 404);
    });
    await check(
      "owner setup requires a valid secret, strong password, and exact fields",
      async () => {
        assert.equal(
          (await request("POST", "/api/auth/setup", { ...ownerInput, code: "A".repeat(43) }))
            .status,
          400,
        );
        assert.equal(
          (await request("POST", "/api/auth/setup", { ...ownerInput, password: "short" })).status,
          400,
        );
        assert.equal(
          (await request("POST", "/api/auth/setup", { ...ownerInput, role: "admin" })).status,
          400,
        );
        assert.equal(store.setupRequired(), true);
      },
    );
    await check(
      "concurrent owner setup creates exactly one admin and permanently consumes code",
      async () => {
        const responses = await Promise.all([
          request("POST", "/api/auth/setup", ownerInput),
          request("POST", "/api/auth/setup", ownerInput),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
        const result = responses.find((r) => r.status === 201)!;
        ownerToken = result.body.token;
        ownerId = result.body.user.id;
        assert.match(ownerToken, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(result.body.user.role, "admin");
        assert.equal(result.body.user.listed, false);
        assert.ok(!("passwordHash" in result.body.user));
        assert.equal(result.headers.get("set-cookie"), null);
        assert.equal((await request("GET", "/api/auth/status")).body.setupRequired, false);
        assert.equal(
          (
            await request("POST", "/api/auth/setup", {
              ...ownerInput,
              email: "secondowner@example.test",
            })
          ).status,
          409,
        );
        assert.equal(
          store.sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n,
          1,
        );
        assert.ok(!readFileSync(setupPath, "utf8").includes(code));
      },
    );
    await check(
      "database stores scrypt passwords and hashed eight-hour sessions only",
      async () => {
        const user = store.sqlite.prepare("SELECT * FROM users WHERE id=?").get(ownerId);
        assert.match(user.password_hash, /^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
        assert.ok(!JSON.stringify(user).includes(password));
        const session = store.sqlite.prepare("SELECT * FROM sessions WHERE user_id=?").get(ownerId);
        assert.equal(session.token_hash, hashSecret(ownerToken));
        assert.notEqual(session.token_hash, ownerToken);
        assert.ok(
          session.expires_at - Date.now() <= SESSION_MS &&
            session.expires_at - Date.now() > SESSION_MS - 15000,
        );
      },
    );
    await check(
      "login validates credentials, normalizes email, and returns no password material",
      async () => {
        assert.equal(
          (
            await request("POST", "/api/auth/login", {
              email: "owner@example.test",
              password: "wrong-long-passphrase",
            })
          ).status,
          401,
        );
        const login = await request("POST", "/api/auth/login", {
          email: " OWNER@EXAMPLE.TEST ",
          password,
        });
        assert.equal(login.status, 200);
        assert.equal(login.body.user.id, ownerId);
        assert.ok(!login.text.includes("password"));
        assert.equal((await request("POST", "/api/auth/logout", {}, login.body.token)).status, 200);
        assert.equal(
          (await request("GET", "/api/member/hub", undefined, login.body.token)).status,
          401,
        );
      },
    );
    await check(
      "enrollment is invite-only, email-bound, expiring, and disallows role injection",
      async () => {
        assert.equal(
          (await request("POST", "/api/auth/accept", { ...memberInput, code: "B".repeat(43) }))
            .status,
          400,
        );
        const created = await request(
          "POST",
          "/api/admin/invites",
          { email: "MEMBER@EXAMPLE.TEST" },
          ownerToken,
        );
        assert.equal(created.status, 201);
        invite = created.body.code;
        assert.ok(
          Date.parse(created.body.expiresAt) - Date.now() <= INVITE_MS &&
            Date.parse(created.body.expiresAt) - Date.now() > INVITE_MS - 15000,
        );
        const row = store.sqlite
          .prepare("SELECT * FROM invitations WHERE email=?")
          .get(memberInput.email);
        assert.equal(row.code_hash, hashSecret(invite));
        assert.equal(
          (
            await request("POST", "/api/auth/accept", {
              ...memberInput,
              email: "different@example.test",
              code: invite,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("POST", "/api/auth/accept", {
              ...memberInput,
              code: invite,
              role: "admin",
            })
          ).status,
          400,
        );
        const expired = await request(
          "POST",
          "/api/admin/invites",
          { email: "expired@example.test" },
          ownerToken,
        );
        store.sqlite
          .prepare("UPDATE invitations SET expires_at=? WHERE email=?")
          .run(Date.now() - 1, "expired@example.test");
        assert.equal(
          (
            await request("POST", "/api/auth/accept", {
              ...memberInput,
              email: "expired@example.test",
              code: expired.body.code,
            })
          ).status,
          400,
        );
      },
    );
    await check(
      "invite acceptance is transactionally single-use even with concurrent requests",
      async () => {
        const results = await Promise.all([
          request("POST", "/api/auth/accept", { ...memberInput, code: invite }),
          request("POST", "/api/auth/accept", { ...memberInput, code: invite }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
        const accepted = results.find((r) => r.status === 201)!;
        memberToken = accepted.body.token;
        memberId = accepted.body.user.id;
        assert.equal(accepted.body.user.role, "member");
        assert.equal(accepted.body.user.listed, false);
        assert.equal(
          (await request("POST", "/api/auth/accept", { ...memberInput, code: invite })).status,
          400,
        );
        assert.equal(
          (await request("POST", "/api/admin/invites", { email: memberInput.email }, ownerToken))
            .status,
          409,
        );
        assert.equal(
          store.sqlite
            .prepare("SELECT COUNT(*) AS n FROM users WHERE email=?")
            .get(memberInput.email).n,
          1,
        );
      },
    );
    await check("members cannot access any admin endpoint or promote themselves", async () => {
      for (const [method, endpoint, body] of allPrivate.filter((r) =>
        r[1].startsWith("/api/admin"),
      ))
        assert.equal((await request(method, endpoint, body, memberToken)).status, 403, endpoint);
      assert.equal(
        (await request("GET", "/api/admin/future-route", undefined, memberToken)).status,
        403,
      );
      for (const extra of [
        { role: "admin" },
        { email: "takeover@example.test" },
        { id: ownerId },
        { passwordHash: "fake" },
      ])
        assert.equal(
          (
            await request(
              "PATCH",
              "/api/member/profile",
              { name: memberInput.name, bio: "", listed: false, ...extra },
              memberToken,
            )
          ).status,
          400,
        );
      assert.equal(
        (await request("GET", "/api/member/hub", undefined, memberToken)).body.user.role,
        "member",
      );
    });
    await check("directory starts empty and honors explicit opt-in and opt-out", async () => {
      assert.deepEqual(
        (await request("GET", "/api/member/hub", undefined, memberToken)).body.members,
        [],
      );
      assert.equal(
        (
          await request(
            "PATCH",
            "/api/member/profile",
            { name: "Member Updated", bio: "Test-only biography", listed: true },
            memberToken,
          )
        ).status,
        200,
      );
      let hub = (await request("GET", "/api/member/hub", undefined, ownerToken)).body;
      assert.equal(hub.members.length, 1);
      assert.equal(hub.members[0].id, memberId);
      assert.deepEqual(Object.keys(hub.members[0]).sort(), ["bio", "email", "id", "name"]);
      assert.equal(
        (
          await request(
            "PATCH",
            "/api/member/profile",
            { name: "Member Updated", bio: "Test-only biography", listed: false },
            memberToken,
          )
        ).status,
        200,
      );
      assert.deepEqual(
        (await request("GET", "/api/member/hub", undefined, ownerToken)).body.members,
        [],
      );
      assert.equal(
        (
          await request(
            "PATCH",
            "/api/member/profile",
            { name: "Member", bio: "", listed: "true" },
            memberToken,
          )
        ).status,
        400,
      );
    });
    await check(
      "events require valid timezone-aware dates and honor public/member visibility",
      async () => {
        const event = {
          title: "Isolated test event",
          date: "2026-10-01T18:00:00-07:00",
          location: "Test-only location",
          description: "This exists only in the test database.",
          visibility: "public",
        };
        for (const date of ["2026-10-01T18:00", "2026-02-30T18:00:00Z", "not-a-date"])
          assert.equal(
            (await request("POST", "/api/admin/events", { ...event, date }, ownerToken)).status,
            400,
          );
        const pub = await request("POST", "/api/admin/events", event, ownerToken);
        assert.equal(pub.status, 201);
        publicEventId = pub.body.id;
        assert.equal(pub.body.date, "2026-10-02T01:00:00.000Z");
        const priv = await request(
          "POST",
          "/api/admin/events",
          { ...event, title: "Private test event", visibility: "members" },
          ownerToken,
        );
        privateEventId = priv.body.id;
        assert.equal(priv.status, 201);
        const publicData = (await request("GET", "/api/public")).body;
        assert.deepEqual(
          publicData.events.map((e: any) => e.id),
          [publicEventId],
        );
        assert.ok(!JSON.stringify(publicData).includes("Private test event"));
        assert.equal(
          (await request("GET", "/api/member/hub", undefined, memberToken)).body.events.length,
          2,
        );
      },
    );
    await check(
      "RSVP add/remove is idempotent and counts unique authenticated members",
      async () => {
        for (let i = 0; i < 2; i++)
          assert.equal(
            (
              await request(
                "POST",
                `/api/member/events/${privateEventId}/rsvp`,
                { attending: true },
                memberToken,
              )
            ).status,
            200,
          );
        await request(
          "POST",
          `/api/member/events/${privateEventId}/rsvp`,
          { attending: true },
          ownerToken,
        );
        let hub = (await request("GET", "/api/member/hub", undefined, memberToken)).body;
        let e = hub.events.find((e: any) => e.id === privateEventId);
        assert.equal(e.rsvped, true);
        assert.equal(e.attendeeCount, 2);
        for (let i = 0; i < 2; i++)
          await request(
            "POST",
            `/api/member/events/${privateEventId}/rsvp`,
            { attending: false },
            memberToken,
          );
        hub = (await request("GET", "/api/member/hub", undefined, memberToken)).body;
        e = hub.events.find((e: any) => e.id === privateEventId);
        assert.equal(e.rsvped, false);
        assert.equal(e.attendeeCount, 1);
        assert.equal(
          (
            await request(
              "POST",
              "/api/member/events/999999/rsvp",
              { attending: true },
              memberToken,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request("POST", "/api/member/events/1x/rsvp", { attending: true }, memberToken))
            .status,
          400,
        );
        assert.equal(
          (
            await request(
              "POST",
              `/api/member/events/${privateEventId}/rsvp`,
              { attending: "true" },
              memberToken,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "POST",
              `/api/member/events/${privateEventId}/rsvp`,
              { attending: true, userId: ownerId },
              memberToken,
            )
          ).status,
          400,
        );
      },
    );
    await check(
      "announcements and plain-text documents remain member-only with no public URLs",
      async () => {
        const a = await request(
          "POST",
          "/api/admin/announcements",
          { title: "Test announcement", body: "Private test announcement body." },
          ownerToken,
        );
        assert.equal(a.status, 201);
        assert.ok(Number.isFinite(Date.parse(a.body.createdAt)));
        const content = "Private plain text. <script>not executable in a text download</script>";
        const doc = await request(
          "POST",
          "/api/admin/documents",
          { title: "../Test notes", description: "Test document", content },
          ownerToken,
        );
        assert.equal(doc.status, 201);
        docId = doc.body.id;
        assert.match(doc.body.filename, /^[a-z0-9-]+\.txt$/);
        assert.ok(!("content" in doc.body));
        assert.ok(!("url" in doc.body));
        const downloaded = await request(
          "GET",
          `/api/member/documents/${docId}`,
          undefined,
          memberToken,
        );
        assert.deepEqual(downloaded.body, {
          filename: doc.body.filename,
          content,
          type: "text/plain",
        });
        assert.equal((await request("GET", `/api/member/documents/${docId}`)).status, 401);
        assert.equal(
          (await request("GET", "/api/member/documents/999999", undefined, memberToken)).status,
          404,
        );
        assert.equal(
          (await request("GET", "/api/member/documents/-1", undefined, memberToken)).status,
          400,
        );
        assert.equal((await request("GET", "/" + doc.body.filename)).status, 404);
        const hub = (await request("GET", "/api/member/hub", undefined, memberToken)).body;
        assert.equal(hub.announcements[0].title, "Test announcement");
        assert.ok(!("content" in hub.documents[0]));
        assert.ok(
          !(await request("GET", "/api/public")).text.includes("Private test announcement"),
        );
      },
    );
    await check(
      "settings persist and contact messages are confined to the admin inbox",
      async () => {
        const settings = {
          about: "Test-only club description",
          venue: "",
          contactEmail: "",
          scheduleNote: "No dates in this test.",
        };
        assert.equal(
          (await request("PATCH", "/api/admin/settings", settings, ownerToken)).status,
          200,
        );
        assert.equal((await request("GET", "/api/public")).body.settings.about, settings.about);
        assert.equal(
          (
            await request(
              "PATCH",
              "/api/admin/settings",
              { clubName: "Unauthorized field" },
              ownerToken,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request("POST", "/api/contact", {
              name: "Contact",
              email: "bad-email",
              message: "Test contact message",
            })
          ).status,
          400,
        );
        const msg = {
          name: "Test Contact",
          email: "contact@example.test",
          message: "Private test-only contact message.",
        };
        assert.deepEqual((await request("POST", "/api/contact", msg)).body, { ok: true });
        const admin = (await request("GET", "/api/admin", undefined, ownerToken)).body;
        assert.equal(admin.inquiries.length, 1);
        assert.equal(admin.inquiries[0].message, msg.message);
        assert.equal(admin.members.length, 2);
        assert.ok(!JSON.stringify(admin).includes("passwordHash"));
        assert.ok(!JSON.stringify(admin).includes("codeHash"));
        assert.ok(!(await request("GET", "/api/public")).text.includes(msg.message));
        assert.ok(
          !(await request("GET", "/api/member/hub", undefined, memberToken)).text.includes(
            msg.message,
          ),
        );
      },
    );
    await check("reissuing invite/recovery codes invalidates previous codes", async () => {
      const first = await request(
        "POST",
        "/api/admin/invites",
        { email: "recovery@example.test" },
        ownerToken,
      );
      const second = await request(
        "POST",
        "/api/admin/invites",
        { email: "recovery@example.test" },
        ownerToken,
      );
      assert.notEqual(first.body.code, second.body.code);
      assert.equal(
        (
          await request("POST", "/api/auth/accept", {
            ...memberInput,
            email: "recovery@example.test",
            code: first.body.code,
          })
        ).status,
        400,
      );
      const joined = await request("POST", "/api/auth/accept", {
        ...memberInput,
        email: "recovery@example.test",
        code: second.body.code,
      });
      assert.equal(joined.status, 201);
      recoveryToken = joined.body.token;
      recoveryId = joined.body.user.id;
      const r1 = await request(
        "POST",
        "/api/admin/reset",
        { email: "recovery@example.test" },
        ownerToken,
      );
      const r2 = await request(
        "POST",
        "/api/admin/reset",
        { email: "recovery@example.test" },
        ownerToken,
      );
      assert.equal(
        (
          await request("POST", "/api/auth/reset", {
            email: "recovery@example.test",
            password: newPassword,
            code: r1.body.code,
          })
        ).status,
        400,
      );
      assert.ok(
        Date.parse(r2.body.expiresAt) - Date.now() <= RESET_MS &&
          Date.parse(r2.body.expiresAt) - Date.now() > RESET_MS - 15000,
      );
      assert.equal(
        (
          await request("POST", "/api/auth/reset", {
            email: "wrong@example.test",
            password: newPassword,
            code: r2.body.code,
          })
        ).status,
        400,
      );
      store.sqlite
        .prepare("UPDATE password_resets SET expires_at=? WHERE code_hash=?")
        .run(Date.now() - 1, hashSecret(r2.body.code));
      assert.equal(
        (
          await request("POST", "/api/auth/reset", {
            email: "recovery@example.test",
            password: newPassword,
            code: r2.body.code,
          })
        ).status,
        400,
      );
    });
    await check(
      "recovery is single-use, changes the password, and revokes every existing session",
      async () => {
        const secondSession = await request("POST", "/api/auth/login", {
          email: "recovery@example.test",
          password,
        });
        assert.equal(secondSession.status, 200);
        const reset = await request(
          "POST",
          "/api/admin/reset",
          { email: "recovery@example.test" },
          ownerToken,
        );
        const input = {
          code: reset.body.code,
          email: "recovery@example.test",
          password: newPassword,
        };
        assert.deepEqual((await request("POST", "/api/auth/reset", input)).body, { ok: true });
        assert.equal((await request("POST", "/api/auth/reset", input)).status, 400);
        for (const token of [recoveryToken, secondSession.body.token])
          assert.equal((await request("GET", "/api/member/hub", undefined, token)).status, 401);
        assert.equal(
          store.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?").get(recoveryId)
            .n,
          0,
        );
        assert.equal(
          (await request("POST", "/api/auth/login", { email: "recovery@example.test", password }))
            .status,
          401,
        );
        assert.equal(
          (
            await request("POST", "/api/auth/login", {
              email: "recovery@example.test",
              password: newPassword,
            })
          ).status,
          200,
        );
      },
    );
    await check("expired sessions cannot read or mutate any protected endpoint", async () => {
      const login = await request("POST", "/api/auth/login", {
        email: memberInput.email,
        password,
      });
      assert.equal(login.status, 200);
      store.sqlite
        .prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?")
        .run(Date.now() - 1, hashSecret(login.body.token));
      for (const [method, endpoint, body] of allPrivate)
        assert.equal(
          (await request(method, endpoint, body, login.body.token)).status,
          401,
          endpoint,
        );
    });
    await check("oversized, malformed and non-JSON requests are safely rejected", async () => {
      assert.equal(
        (
          await request(
            "PATCH",
            "/api/member/profile",
            { name: "x".repeat(81), bio: "", listed: false },
            memberToken,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "POST",
            "/api/admin/documents",
            { title: "Too long", description: "", content: "x".repeat(100001) },
            ownerToken,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "POST",
            "/api/admin/documents",
            { title: "Too large", description: "", content: "x".repeat(180000) },
            ownerToken,
          )
        ).status,
        413,
      );
      const malformed = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"password":"SECRET_NOT_TO_ECHO",',
      });
      assert.equal(malformed.status, 400);
      assert.ok(!(await malformed.text()).includes("SECRET_NOT_TO_ECHO"));
      const plain = await fetch(base + "/api/contact", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      });
      assert.equal(plain.status, 415);
    });
    await check("contact abuse is rate-limited without storing rejected messages", async () => {
      const input = {
        name: "Rate test",
        email: "rate@example.test",
        message: "Rate limit test message.",
      };
      for (let i = 0; i < 3; i++)
        assert.equal((await request("POST", "/api/contact", input)).status, 201);
      const limited = await request("POST", "/api/contact", input);
      assert.equal(limited.status, 429);
      assert.ok(limited.headers.get("retry-after"));
      assert.equal(store.sqlite.prepare("SELECT COUNT(*) AS n FROM inquiries").get().n, 4);
    });
    await check("authentication abuse is throttled even with spoofed proxy headers", async () => {
      let saw429 = false;
      for (let i = 0; i < 60; i++) {
        const response = await request(
          "POST",
          "/api/auth/login",
          { email: "abuse@example.test", password: "invalid-test-password" },
          undefined,
          { "X-Forwarded-For": `10.0.0.${i}` },
        );
        if (response.status === 429) {
          saw429 = true;
          assert.ok(response.headers.get("retry-after"));
          break;
        }
        assert.equal(response.status, 401);
      }
      assert.equal(saw429, true);
    });
    await check(
      "SQLite content and hashed sessions survive restart; owner setup stays disabled",
      async () => {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        store.close();
        store = new DatabaseStorage(dbPath, setupPath);
        ({ httpServer } = await createApplication({ storage: store, apiOnly: true }));
        httpServer.listen(5001, "127.0.0.1");
        await once(httpServer, "listening");
        assert.equal((await request("GET", "/api/auth/status")).body.setupRequired, false);
        const hub = await request("GET", "/api/member/hub", undefined, memberToken);
        assert.equal(hub.status, 200);
        assert.equal(hub.body.events.length, 2);
        assert.equal(hub.body.documents[0].id, docId);
        assert.equal(
          (await request("GET", "/api/public")).body.settings.about,
          "Test-only club description",
        );
        assert.equal((await request("POST", "/api/auth/setup", ownerInput)).status, 409);
        assert.equal((await request("POST", "/api/auth/logout", {}, memberToken)).status, 200);
        assert.equal((await request("GET", "/api/member/hub", undefined, memberToken)).status, 401);
      },
    );
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    store.close();
    writeFileSync(
      path.resolve("tests/backend-test-results.json"),
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          isolatedDatabase: true,
          port: 5001,
          passed: outcomes.length,
          tests: outcomes,
        },
        null,
        2,
      ),
    );
  }
});
