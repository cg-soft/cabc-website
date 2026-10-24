import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createApp } from "./server.mjs";
import { openDatabase, addMember, clubToday, ROOT } from "./db.mjs";

test("minimal club authentication, calendar and dance cards", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cabc-minimal-test-"));
  const filename = path.join(directory, "test.sqlite");
  const password = "Test-only-secret-12345!";
  let db, server;
  try {
    await t.test("startup requires explicit initialization and rejects public storage", () => {
      assert.throws(() => openDatabase(filename), /not initialized/);
      assert.equal(existsSync(filename), false);
      assert.throws(() => openDatabase(path.join(directory, "public", "test.sqlite"), true), /outside public/);
    });
    db = openDatabase(filename, true);
    const admin = addMember(db, { name: "Admin", email: "admin@example.test", password }, "admin");
    const alice = addMember(db, { name: "Alice", email: "alice@example.test", password });
    const bob = addMember(db, { name: "Bob", email: "bob@example.test", password });
    const carol = addMember(db, { name: "Carol", email: "carol@example.test", password });
    const future = new Date(new Date(`${clubToday()}T12:00:00Z`).valueOf() + 30 * 86400000).toISOString().slice(0, 10);
    db.prepare("INSERT INTO games(date,time) VALUES(?,'11:30')").run(future);
    db.prepare("INSERT INTO games(date,time) VALUES('2000-01-01','11:30')").run();
    const game = db.prepare("SELECT id FROM games WHERE date=?").get(future).id;
    server = createApp({ db });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const req = async (route, method = "GET", data, token) => {
      const response = await fetch(base + route, {
        method, headers: { ...(data !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data)
      });
      const result = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
      return { status: response.status, result };
    };
    const login = async (email) => (await req("/api/login", "POST", { email, password })).result;
    let a, b, c, owner;
    await t.test("original favicon is linked and served as PNG on GET and HEAD", async () => {
      const home = await req("/");
      assert.match(home.result, /rel="icon"[^>]*href="\.\/favicon\.png"/);
      const response = await fetch(base + "/favicon.png");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(path.join(ROOT, "public/favicon.png")));
      const head = await fetch(base + "/favicon.png", { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("content-type"), "image/png");
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    });
    await t.test("transparent club logo is persistent in the shell and publicly served on GET/HEAD", async () => {
      const home = await req("/");
      assert.equal((home.result.match(/class="floating-club-logo"/g) || []).length, 1);
      assert.match(home.result, /<img class="floating-club-logo"[^>]*src="\.\/club-logo\.png"[^>]*alt="Chinese American Bridge Club"/);
      assert.ok(home.result.indexOf('class="floating-club-logo"') < home.result.indexOf('id="app"'));
      const image = readFileSync(path.join(ROOT, "public/club-logo.png"));
      assert.equal(image.subarray(1, 4).toString(), "PNG");
      assert.equal(image[25], 6, "PNG must retain RGBA transparency");
      const response = await fetch(base + "/club-logo.png");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
      const head = await fetch(base + "/club-logo.png", { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("content-type"), "image/png");
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal((await req("/club-logo.png", "POST", {})).status, 405);
    });
    await t.test("production has no preview bypass and private paths are never served", async () => {
      assert.equal((await req("/api/preview", "POST", { role: "admin" })).status, 404);
      assert.equal((await req("/api/config")).result.preview, false);
      for (const file of ["/data/test.sqlite", "/server.mjs", "/schema.sql", "/.git/config"])
        assert.equal((await req(file)).status, 404);
      assert.throws(() => createApp({ db, preview: true }), /explicitly seeded/);
    });
    await t.test("login is real, protected APIs require authentication, secrets stay private", async () => {
      assert.equal((await req(`/api/calendar?month=${future.slice(0, 7)}`)).status, 401);
      assert.equal((await req("/api/login", "POST", { email: "alice@example.test", password: "incorrect" })).status, 401);
      [a, b, c, owner] = await Promise.all(["alice", "bob", "carol", "admin"].map(name => login(`${name}@example.test`)));
      assert.equal(a.member.id, alice); assert.equal(owner.member.role, "admin");
      assert.match(a.token, /^[a-f0-9]{64}$/);
      assert.notEqual(db.prepare("SELECT password FROM members WHERE id=?").get(alice).password, password);
      assert.equal(db.prepare("SELECT hash FROM sessions WHERE hash=?").get(a.token), undefined);
      const payload = await req(`/api/calendar?month=${future.slice(0, 7)}`, "GET", undefined, a.token);
      assert.equal(payload.status, 200);
      assert.equal(JSON.stringify(payload.result).includes(password), false);
      assert.equal(JSON.stringify(payload.result).includes("@example.test"), false);
      assert.equal(payload.result.members.length, 4);
      assert.equal((await req("/api/calendar?month=bad", "GET", undefined, a.token)).status, 400);
    });
    await t.test("member cannot add members or playing dates; administrator can", async () => {
      const member = { name: "<script>Example</script>", email: "new@example.test", password };
      assert.equal((await req("/api/members", "POST", member, a.token)).status, 403);
      assert.equal((await req("/api/games", "POST", { date: future, time: "11:30" }, a.token)).status, 403);
      assert.equal((await req("/api/members", "POST", member, owner.token)).status, 201);
      assert.equal((await req("/api/members", "POST", member, owner.token)).status, 409);
      assert.equal((await req("/api/members", "POST", { ...member, email: "bad" }, owner.token)).status, 400);
      assert.equal((await req("/api/games", "POST", { date: "2026-02-30", time: "11:30" }, owner.token)).status, 400);
      assert.equal((await req("/api/games", "POST", { date: future, time: "11:30" }, owner.token)).status, 409);
      assert.equal((await req("/api/games", "POST", { date: "2098-01-05", time: "11:30" }, owner.token)).status, 201);
    });
    await t.test("register solo, then register both partners atomically", async () => {
      assert.equal((await req(`/api/games/${game}/entry`, "POST", { partnerId: null }, a.token)).status, 200);
      assert.equal((await req(`/api/games/${game}/entry`, "POST", { partnerId: alice }, a.token)).status, 400);
      assert.equal((await req(`/api/games/${game}/entry`, "POST", { partnerId: bob }, a.token)).status, 200);
      assert.equal(db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(game, alice).partner_id, bob);
      assert.equal(db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(game, bob).partner_id, alice);
      assert.equal((await req(`/api/games/${game}/entry`, "POST", { partnerId: bob }, c.token)).status, 409);
      assert.equal(db.prepare("SELECT * FROM entries WHERE game_id=? AND member_id=?").get(game, carol), undefined);
    });
    await t.test("cancellation removes only self and keeps former partner looking", async () => {
      assert.equal((await req(`/api/games/${game}/entry`, "DELETE", {}, a.token)).status, 200);
      assert.equal(db.prepare("SELECT * FROM entries WHERE game_id=? AND member_id=?").get(game, alice), undefined);
      assert.equal(db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(game, bob).partner_id, null);
    });
    await t.test("concurrent pair requests cannot double-book a member", async () => {
      const results = await Promise.all([a.token, c.token].map(token => req(`/api/games/${game}/entry`, "POST", { partnerId: bob }, token)));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      assert.equal(db.prepare("SELECT count(*) AS n FROM entries WHERE game_id=? AND partner_id IS NOT NULL").get(game).n, 2);
    });
    await t.test("past dates are read-only and SQL injection is rejected as input", async () => {
      const past = db.prepare("SELECT id FROM games WHERE date='2000-01-01'").get().id;
      assert.equal((await req(`/api/games/${past}/entry`, "POST", { partnerId: null }, a.token)).status, 409);
      assert.equal((await req(`/api/games/${past}/entry`, "DELETE", {}, a.token)).status, 409);
      assert.equal((await req(`/api/games/${game}/entry`, "POST", { partnerId: "1;DROP TABLE members" }, a.token)).status, 400);
      assert.equal(db.prepare("SELECT count(*) AS n FROM members").get().n, 5);
    });
    await t.test("logout invalidates session; expired sessions are rejected", async () => {
      assert.equal((await req("/api/logout", "POST", {}, a.token)).status, 200);
      assert.equal((await req(`/api/calendar?month=${future.slice(0, 7)}`, "GET", undefined, a.token)).status, 401);
      db.prepare("UPDATE sessions SET expires=0 WHERE member_id=?").run(carol);
      assert.equal((await req(`/api/calendar?month=${future.slice(0, 7)}`, "GET", undefined, c.token)).status, 401);
    });
    await t.test("authentication throttling limits repeated guesses", async () => {
      let result;
      for (let i = 0; i < 32; i++) result = await req("/api/login", "POST", { email: "none@example.test", password: "wrong" });
      assert.equal(result.status, 429);
    });
    await new Promise(resolve => server.close(resolve)); server = undefined;
    db.close(); db = undefined;
    await t.test("registrations and users persist after reopening the database", () => {
      db = openDatabase(filename);
      assert.equal(db.prepare("SELECT count(*) AS n FROM members").get().n, 5);
      assert.equal(db.prepare("SELECT count(*) AS n FROM entries WHERE game_id=?").get(game).n, 2);
      db.close(); db = undefined;
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db?.close(); rmSync(directory, { recursive: true, force: true });
  }
});
