import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import vm from "node:vm";
import { createApp } from "./server.mjs";
import { openDatabase, addMember, hashToken, ROOT } from "./db.mjs";

const password = "Fictional-Remember-Device-12345";
const cookieName = "__Host-cabc_session";
const rememberedMs = 30 * 86400000;

async function fixture(t, preview = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-remember-"));
  const filename = path.join(directory, "club.sqlite");
  const db = openDatabase(filename, true), ids = {};
  for (const [name, role] of [["Admin", "admin"], ["Other Admin", "admin"], ["Member", "member"], ["Other Member", "member"], ["-Guest-", "member"]])
    ids[name] = addMember(db, { name, email: `${Object.keys(ids).length}@example.test`, password }, role);
  db.prepare("INSERT INTO games(id,date,time,name) VALUES(1,'2099-12-01','11:30','Remember QA')").run();
  if (preview) db.prepare("INSERT INTO metadata(key,value) VALUES('preview','1')").run();
  let server, base;
  async function start() {
    server = createApp({ db, preview });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  await start();
  async function stop() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  t.after(async () => { await stop(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  async function request(route, { method = "GET", body, cookie, csrf, token, headers = {} } = {}) {
    const response = await fetch(base + "/api" + route, {
      method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  async function login(index = 2, remembered = true, cookie) {
    const result = await request("/login", { method: "POST", cookie,
      body: { email: `${index}@example.test`, password, rememberDevice: remembered } });
    assert.equal(result.status, 200);
    return { ...result, cookie: result.headers.get("set-cookie")?.split(";")[0], csrf: result.body.csrfToken };
  }
  return { db, filename, ids, request, login, async restart() { await stop(); await start(); } };
}

test("ordinary/default sign-in remains a 12-hour in-memory bearer session", async t => {
  const f = await fixture(t);
  for (const rememberDevice of [undefined, false]) {
    const before = Date.now();
    const result = await f.request("/login", { method: "POST",
      body: { email: "2@example.test", password, ...(rememberDevice === undefined ? {} : { rememberDevice }) } });
    assert.equal(result.status, 200); assert.equal(result.body.remembered, false);
    assert.match(result.body.token, /^[a-f0-9]{64}$/);
    assert.match(result.headers.get("set-cookie"), /Max-Age=0/);
    const row = f.db.prepare("SELECT * FROM sessions WHERE hash=?").get(hashToken(result.body.token));
    assert.ok(row.expires >= before + 12 * 3600000 && row.expires <= Date.now() + 12 * 3600000);
    assert.notEqual(row.hash, result.body.token);
    assert.equal((await f.request("/calendar", { token: result.body.token })).status, 200);
  }
  assert.equal((await f.request("/session")).status, 401);
  assert.equal((await f.request("/config")).body.rememberDevice, true);
});

test("remembered login sets a hardened 30-day cookie without exposing its credential in JSON", async t => {
  const f = await fixture(t), before = Date.now(), result = await f.login();
  const header = result.headers.get("set-cookie");
  assert.match(header, /^__Host-cabc_session=[a-f0-9]{64};/);
  for (const flag of ["Path=/", "Max-Age=2592000", "HttpOnly", "Secure", "SameSite=Strict"]) assert.ok(header.includes(flag));
  assert.doesNotMatch(header, /Domain=/i);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.body.token, undefined);
  assert.equal(result.body.remembered, true);
  assert.match(result.csrf, /^[a-f0-9]{64}$/);
  const token = result.cookie.split("=")[1];
  assert.notEqual(token, result.csrf);
  assert.ok(!JSON.stringify(result.body).includes(token));
  assert.ok(!JSON.stringify(result.body).includes(password));
  const row = f.db.prepare("SELECT * FROM sessions WHERE hash=?").get(hashToken(token));
  assert.ok(row.expires >= before + rememberedMs && row.expires <= Date.now() + rememberedMs);
  assert.equal((await f.request("/calendar", { token: result.csrf })).status, 401);
});

test("restoration survives app restart, reflects current roles and never slides the expiry", async t => {
  const f = await fixture(t), login = await f.login();
  const before = f.db.prepare("SELECT * FROM sessions").all();
  await f.restart();
  const result = await f.request("/session", { cookie: login.cookie });
  assert.equal(result.status, 200); assert.equal(result.body.member.id, f.ids.Member);
  assert.equal(result.body.remembered, true); assert.equal(result.body.csrfToken, login.csrf);
  assert.equal(result.body.token, undefined); assert.equal(result.headers.get("set-cookie"), null);
  assert.deepEqual(f.db.prepare("SELECT * FROM sessions").all(), before);
  f.db.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.ids.Member);
  assert.equal((await f.request("/session", { cookie: login.cookie })).body.member.role, "admin");
  assert.equal((await f.request("/calendar", { cookie: login.cookie })).status, 200);
});

test("cookie writes require the matching CSRF token and reject cross-site requests", async t => {
  const f = await fixture(t), login = await f.login();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const csrf of [undefined, "invalid", "a".repeat(64)]) {
      const result = await f.request("/games/1/entry", { method, cookie: login.cookie, csrf, body: { partnerId: null } });
      assert.equal(result.status, 403);
    }
  }
  assert.equal((await f.request("/games/1/entry", { method: "POST", cookie: login.cookie, csrf: login.csrf,
    headers: { "Sec-Fetch-Site": "cross-site" }, body: { partnerId: null } })).status, 403);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM entries").get().n, 0);
  assert.equal((await f.request("/games/1/entry", { method: "POST", cookie: login.cookie,
    csrf: login.csrf, body: { partnerId: null } })).status, 200);
  assert.equal((await f.request("/games/1/entry", { method: "DELETE", cookie: login.cookie,
    csrf: login.csrf, body: {} })).status, 200);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM entries").get().n, 0);
});

test("bearer compatibility is explicit; invalid bearer credentials never fall back to a cookie", async t => {
  const f = await fixture(t), cookieLogin = await f.login(), bearer = await f.login(3, false);
  for (const token of ["", "invalid", "a".repeat(64)])
    assert.equal((await f.request("/calendar", { cookie: cookieLogin.cookie, token })).status, 401);
  assert.equal((await f.request("/games/1/entry", { method: "POST", token: bearer.body.token,
    cookie: cookieLogin.cookie, body: { partnerId: null } })).status, 200);
  assert.equal(f.db.prepare("SELECT member_id FROM entries").get().member_id, f.ids["Other Member"]);
});

test("logout revokes the remembered credential, clears the cookie and preserves other devices", async t => {
  const f = await fixture(t), one = await f.login(), other = await f.login();
  const result = await f.request("/logout", { method: "POST", cookie: one.cookie, csrf: one.csrf, body: {} });
  assert.equal(result.status, 200); assert.match(result.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await f.request("/session", { cookie: one.cookie })).status, 401);
  assert.equal((await f.request("/session", { cookie: other.cookie })).status, 200);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM sessions").get().n, 1);
});

test("password changes revoke every remembered and ordinary session", async t => {
  const f = await fixture(t), one = await f.login(), other = await f.login(), ordinary = await f.login(2, false);
  const next = "Changed-Fictional-Password-12345";
  const result = await f.request("/password", { method: "POST", cookie: one.cookie, csrf: one.csrf,
    body: { currentPassword: password, newPassword: next, confirmPassword: next } });
  assert.equal(result.status, 200); assert.match(result.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
  assert.equal((await f.request("/session", { cookie: other.cookie })).status, 401);
  assert.equal((await f.request("/calendar", { token: ordinary.body.token })).status, 401);
});

test("operator password reset also revokes remembered sessions", async t => {
  const f = await fixture(t), login = await f.login();
  const child = spawn(process.execPath, ["--import",
    "data:text/javascript,Object.defineProperty(process.stdin,'isTTY',{value:true})", "manage.mjs", "reset-password"],
  { cwd: ROOT, env: { ...process.env, DB_PATH: f.filename }, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", answered = false;
  const timer = setTimeout(() => child.kill("SIGTERM"), 10000);
  child.stdout.on("data", chunk => {
    output += chunk;
    if (!answered && output.includes("Email: ")) { answered = true; child.stdin.write("2@example.test\n"); }
  });
  child.stderr.resume();
  const [code] = await once(child, "close"); clearTimeout(timer);
  assert.equal(code, 0);
  assert.equal((await f.request("/session", { cookie: login.cookie })).status, 401);
});

test("deactivation revokes a remembered member and blocks later login", async t => {
  const f = await fixture(t), member = await f.login(), admin = await f.login(0, false);
  const plan = await f.request(`/members/${f.ids.Member}/deactivate`, { token: admin.body.token });
  assert.equal((await f.request(`/members/${f.ids.Member}/deactivate`, { method: "POST",
    token: admin.body.token, body: { confirm: true, revision: plan.body.revision } })).status, 200);
  const result = await f.request("/session", { cookie: member.cookie });
  assert.equal(result.status, 401); assert.match(result.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await f.request("/login", { method: "POST",
    body: { email: "2@example.test", password, rememberDevice: true } })).status, 401);
});

test("expired, malformed, unknown, duplicate and placeholder cookies fail closed", async t => {
  const f = await fixture(t), login = await f.login(), token = login.cookie.split("=")[1];
  f.db.prepare("UPDATE sessions SET expires=? WHERE hash=?").run(Date.now() - 1, hashToken(token));
  const expired = await f.request("/session", { cookie: login.cookie });
  assert.equal(expired.status, 401); assert.match(expired.headers.get("set-cookie"), /Max-Age=0/);
  for (const cookie of [`${cookieName}=bad`, `${cookieName}=${"b".repeat(64)}`, `${login.cookie}; ${login.cookie}`, `${cookieName}=%61`])
    assert.equal((await f.request("/session", { cookie })).status, 401);
  const guest = "c".repeat(64);
  f.db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hashToken(guest), f.ids["-Guest-"], Date.now() + rememberedMs);
  assert.equal((await f.request("/session", { cookie: `${cookieName}=${guest}` })).status, 401);
});

test("unchecked login and account switching revoke the browser's previous remembered session", async t => {
  const f = await fixture(t), old = await f.login(), ordinary = await f.login(3, false, old.cookie);
  assert.match(ordinary.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await f.request("/session", { cookie: old.cookie })).status, 401);
  const next = await f.login(), switched = await f.login(0, true, next.cookie);
  assert.notEqual(next.cookie, switched.cookie);
  assert.equal((await f.request("/session", { cookie: next.cookie })).status, 401);
  assert.equal((await f.request("/session", { cookie: switched.cookie })).body.member.role, "admin");
});

test("remembering is strictly opt-in and unavailable to shared preview accounts", async t => {
  const f = await fixture(t);
  for (const rememberDevice of ["true", "false", 1, null]) {
    assert.equal((await f.request("/login", { method: "POST",
      body: { email: "2@example.test", password, rememberDevice } })).status, 400);
  }
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
  assert.equal((await f.request("/login", { method: "POST",
    body: { email: "2@example.test", password: "incorrect", rememberDevice: true } })).status, 401);
  const preview = await fixture(t, true);
  assert.equal((await preview.request("/config")).body.rememberDevice, false);
  const login = await preview.login(2, true);
  assert.equal(login.headers.get("set-cookie"), null);
  assert.equal(login.body.remembered, false); assert.match(login.body.token, /^[a-f0-9]{64}$/);
});

function browserModel() {
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const handlers = {}, requests = [], dialog = { open: false, addEventListener() {} };
  const location = { hash: "#about" };
  const window = { addEventListener() {}, navigator: { onLine: true } };
  const sandbox = { window, location, console, document: {
    hidden: false, querySelector: s => s === "#dialog" ? dialog : {},
    addEventListener(name, callback) { handlers[name] = callback; }
  }, fetch: async (url, options) => { requests.push({ url, options }); return {
    ok: true, json: async () => url.endsWith("/config") ? { rememberDevice: true } :
      { member: { id: 1, name: "Admin", role: "admin" }, remembered: true, csrfToken: "a".repeat(64) }
  }; } };
  vm.runInNewContext(source.replace("  route();\n})();",
    "  window.model = {state, app, renderLogin, api, acceptIdentity, clearIdentity, restoreRememberedSession, sessionIdentity};\n})();"), sandbox);
  return { ...window.model, window, location, requests, handlers };
}

test("startup restores cookie identity, resets acting-for, and does not hijack public pages", async () => {
  const model = browserModel();
  model.state.actingMemberId = 99;
  await model.restoreRememberedSession();
  assert.equal(model.state.user.id, 1); assert.equal(model.state.actingMemberId, null);
  assert.equal(model.state.token, null); assert.equal(model.location.hash, "#about");
  assert.equal(model.sessionIdentity(), "a".repeat(64));
  await model.api("/games/1/entry", "POST", {});
  assert.equal(model.requests.at(-1).options.headers["X-CSRF-Token"], "a".repeat(64));
  assert.equal(model.requests.at(-1).options.headers.Authorization, undefined);
  assert.equal(model.requests.at(-1).options.credentials, "same-origin");
});

test("personal-device guidance stays below the title in the checkbox's text column", () => {
  const model = browserModel();
  model.renderLogin();
  assert.match(model.app.innerHTML,
    /<label class="remember-device"><input[^>]+aria-labelledby="remember-label"[^>]+aria-describedby="remember-help"[^>]*><span class="remember-device-copy"><span id="remember-label">Remember this device for 30 days<\/span><span class="small-note" id="remember-help">Use only on a personal device\.<\/span><\/span><\/label>/);
});

test("restoration navigates login to calendar and never revives an explicitly cleared identity", async () => {
  const model = browserModel(); model.location.hash = "#login";
  await model.restoreRememberedSession();
  assert.equal(model.location.hash, "#calendar");
  model.clearIdentity(); model.location.hash = "#login";
  const pending = model.restoreRememberedSession();
  model.clearIdentity();
  await pending;
  assert.equal(model.state.user, null);
  assert.equal(model.state.csrfToken, null);
  assert.equal(model.location.hash, "#login");
});
