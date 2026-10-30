import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import tls from "node:tls";
import vm from "node:vm";
import nodemailer from "nodemailer";
import { openDatabase, addMember, privateFile } from "./db.mjs";
import { createApp } from "./server.mjs";
import { migrateNotifications } from "./migrate.mjs";
import { preference, setPreference, queueChanges, entrySnapshot, processQueue, mailConfiguration, renderMail } from "./notifications.mjs";
import { runWorker } from "./mail-worker.mjs";

for (const success of [true, false]) test(`email preference dialog unlocks after ${success ? "saving" : "an API error"}`, async () => {
  const handlers = {}, closer = { disabled: false }, submit = { isConnected: true }, error = { isConnected: true };
  const dialog = { dataset: {}, open: true, addEventListener() {},
    querySelectorAll: () => [closer], close() { this.open = false; } };
  const toast = { classList: { add() {}, remove() {} } };
  let respond;
  const sandbox = {
    document: {
      querySelector: selector => selector === "#dialog" ? dialog : selector === "#toast" ? toast : {},
      addEventListener: (name, handler) => { handlers[name] = handler; }
    },
    window: { addEventListener() {} }, setTimeout() {}, clearTimeout() {},
    FormData: class { [Symbol.iterator]() { return [["enabled", "false"]][Symbol.iterator](); } },
    fetch: () => new Promise(resolve => { respond = resolve; })
  };
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  vm.runInNewContext(source.replace("  route();\n})();", "  window.state = state;\n})();"), sandbox);
  sandbox.window.state.user = { id: 1, role: "member" };
  const form = { id: "email-preferences-form", querySelector: selector => selector === '[type="submit"]' ? submit : error };
  const pending = handlers.submit({ preventDefault() {}, target: form });
  assert.equal(dialog.dataset.memberPending, "true"); assert.equal(closer.disabled, true);
  respond({ ok: success, status: success ? 200 : 503, json: async () => success ? { enabled: false } : { error: "Fictional API failure" } });
  await pending;
  assert.equal(dialog.dataset.memberPending, undefined); assert.equal(closer.disabled, false);
  assert.equal(submit.disabled, false);
  if (!success) assert.match(error.textContent, /Fictional API failure/);
  dialog.open = true;
  await handlers.click({ target: { closest: selector => selector === "[data-action]" ? { dataset: { action: "close-dialog" } } : null } });
  assert.equal(dialog.open, false, "Cancel remains usable on the next dialog");
});

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-mail-"));
  const filename = path.join(directory, "club.sqlite"), db = openDatabase(filename, true);
  const ids = {};
  for (const [name, role] of [["Administrator", "admin"], ["Member One", "member"], ["Member Two", "member"], ["-Guest-", "member"], ["Member Three", "member"]])
    ids[name] = addMember(db, { name, email: `${Object.keys(ids).length}@example.test`, password: "Fictional-Password-12345" }, role);
  const actor = { id: ids.Administrator, name: "Administrator" };
  const game = { id: 1, date: "2099-11-02", time: "11:30", name: "Fictional Mail QA" };
  db.prepare("INSERT INTO games(id,date,time,name) VALUES(?,?,?,?)").run(game.id, game.date, game.time, game.name);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { db, filename, directory, ids, actor, game };
}
async function apiFixture(t) {
  const f = fixture(t), server = createApp({ db: f.db, preview: false, previewToday: undefined });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { method = "GET", body, token } = {}) {
    const response = await fetch(base + "/api" + route, { method, headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {})
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function login(email) {
    const result = await request("/login", { method: "POST", body: { email, password: "Fictional-Password-12345" } });
    assert.equal(result.status, 200); return result.body.token;
  }
  return { ...f, request, admin: await login("0@example.test"), one: await login("1@example.test"), two: await login("2@example.test") };
}
function queueOne(f, options = {}) {
  f.db.prepare("INSERT INTO entries(game_id,member_id,partner_id) VALUES(?,?,NULL) ON CONFLICT DO NOTHING").run(f.game.id, f.ids["Member One"]);
  queueChanges(f.db, { game: f.game, before: [], after: [{ member_id: f.ids["Member One"], partner_id: null }], actor: f.actor, ...options });
}

test("email migration is explicit, additive, repeatable and preserves all original rows", t => {
  const f = fixture(t);
  // Disposable baseline fixture only; never drop tables in an installed database.
  f.db.exec("DROP TABLE notification_outbox; DROP TABLE notification_preferences;");
  const first = migrateNotifications(f.filename);
  assert.equal(first.applied, true); assert.deepEqual(first.before, first.after);
  assert.equal(migrateNotifications(f.filename).applied, false);
  assert.equal(f.db.prepare("PRAGMA user_version").get().user_version, 1);
  assert.throws(() => migrateNotifications(path.join(f.directory, "missing.sqlite")), /not found/);
});
test("registration/cancellation emails snapshot both real members and accurate partner status", async t => {
  const f = await apiFixture(t);
  let r = await f.request("/games/1/entry", { method: "POST", token: f.one, body: { partnerId: f.ids["Member Two"] } });
  assert.equal(r.status, 200);
  let rows = f.db.prepare("SELECT * FROM notification_outbox").all();
  assert.equal(rows.length, 2); assert.equal(new Set(rows.map(r => r.event_id)).size, 1);
  assert.ok(rows.every(r => JSON.parse(r.payload_json).kind === "registered"));
  r = await f.request("/games/1/entry", { method: "DELETE", token: f.one, body: {} });
  assert.equal(r.status, 200);
  rows = f.db.prepare("SELECT * FROM notification_outbox").all().slice(2);
  assert.deepEqual(rows.map(r => JSON.parse(r.payload_json).kind).sort(), ["cancelled", "partner-cancelled"]);
  const partner = rows.find(r => JSON.parse(r.payload_json).kind === "partner-cancelled");
  assert.match(renderMail(JSON.parse(partner.payload_json), "a".repeat(64)).text, /remain registered/);
  assert.equal(f.db.prepare("SELECT partner_id FROM entries WHERE game_id=1 AND member_id=?").get(f.ids["Member Two"]).partner_id, null);
});
test("duplicate no-op registration/cancellation and rejected requests enqueue nothing", async t => {
  const f = await apiFixture(t);
  for (let i = 0; i < 2; i++) assert.equal((await f.request("/games/1/entry", { method: "POST", token: f.one, body: { partnerId: null } })).status, 200);
  assert.equal(f.db.prepare("SELECT count(*) n FROM notification_outbox").get().n, 1);
  assert.equal((await f.request("/games/1/entry", { method: "POST", token: f.one, body: { partnerId: f.ids["Member One"] } })).status, 400);
  for (let i = 0; i < 2; i++) await f.request("/games/1/entry", { method: "DELETE", token: f.one, body: {} });
  assert.equal(f.db.prepare("SELECT count(*) n FROM notification_outbox").get().n, 2);
});
test("outbox and calendar writes roll back together on failure", async t => {
  const f = await apiFixture(t);
  f.db.exec("CREATE TRIGGER fail_mail BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.equal((await f.request("/games/1/entry", { method: "POST", token: f.one, body: { partnerId: null } })).status, 500);
  assert.equal(f.db.prepare("SELECT count(*) n FROM entries").get().n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM notification_preferences").get().n, 0);
});
test("opt-out defaults on, is self-only, persists and suppresses new queued mail", async t => {
  const f = await apiFixture(t);
  assert.equal((await f.request("/email/preferences", { token: f.one })).body.enabled, true);
  assert.equal((await f.request("/email/preferences", { method: "PATCH", token: f.admin, body: { memberId: f.ids["Member One"], enabled: false } })).status, 400);
  assert.equal((await f.request("/email/preferences", { method: "PATCH", token: f.one, body: { enabled: "false" } })).status, 400);
  assert.equal((await f.request("/email/preferences", { method: "PATCH", token: f.one, body: { enabled: false } })).status, 200);
  await f.request("/games/1/entry", { method: "POST", token: f.two, body: { partnerId: f.ids["Member One"] } });
  assert.deepEqual(f.db.prepare("SELECT member_id FROM notification_outbox").all().map(r => r.member_id), [f.ids["Member Two"]]);
  assert.equal((await f.request("/email/preferences", { token: f.one })).body.enabled, false);
  assert.equal((await f.request("/email/preferences")).status, 401);
});
test("anonymous opt-out requires POST confirmation; re-enabling revokes old links and leaks no identity", async t => {
  const f = await apiFixture(t), old = preference(f.db, f.ids["Member One"]).token;
  await f.request("/email/opt-out?token=" + old);
  assert.equal(preference(f.db, f.ids["Member One"]).enabled, 1);
  const result = await f.request("/email/opt-out", { method: "POST", body: { token: old } });
  assert.deepEqual(result, { status: 200, body: { ok: true } });
  assert.equal(preference(f.db, f.ids["Member One"]).enabled, 0);
  await f.request("/email/preferences", { method: "PATCH", token: f.one, body: { enabled: true } });
  assert.notEqual(preference(f.db, f.ids["Member One"]).token, old);
  assert.equal((await f.request("/email/opt-out", { method: "POST", body: { token: old } })).status, 410);
  assert.equal((await f.request("/email/opt-out", { method: "POST", body: { token: "bad" } })).status, 400);
  const publicPref = await f.request("/email/preferences", { token: f.one });
  assert.deepEqual(Object.keys(publicPref.body), ["enabled"]);
});
test("game cancellation preserves a per-member snapshot after deletion and excludes placeholders", async t => {
  const f = await apiFixture(t);
  await f.request("/games/1/entry", { method: "POST", token: f.one, body: { partnerId: f.ids["-Guest-"] } });
  f.db.exec("DELETE FROM notification_outbox");
  const plan = await f.request("/games/1/manage", { token: f.admin });
  assert.equal((await f.request("/games/1/manage", { method: "DELETE", token: f.admin, body: { confirm: true, revision: plan.body.revision } })).status, 200);
  const rows = f.db.prepare("SELECT * FROM notification_outbox").all();
  assert.equal(rows.length, 1);
  const payload = JSON.parse(rows[0].payload_json);
  assert.equal(payload.kind, "game-cancelled"); assert.equal(payload.game.name, f.game.name);
  assert.equal(f.db.prepare("SELECT count(*) n FROM games").get().n, 0);
});
test("delegated registration identifies the actor but respects the recipient's own preference", async t => {
  const f = await apiFixture(t);
  setPreference(f.db, f.ids.Administrator, false);
  const plan = await f.request("/games/1/manage", { token: f.admin });
  assert.equal((await f.request("/games/1/entry", { method: "POST", token: f.admin, body: {
    memberId: f.ids["Member One"], confirm: true, revision: plan.body.revision, partnerId: null
  } })).status, 200);
  const payload = JSON.parse(f.db.prepare("SELECT payload_json FROM notification_outbox").get().payload_json);
  assert.equal(payload.delegated, true); assert.equal(payload.actorName, "Administrator");
  assert.equal(f.db.prepare("SELECT count(*) n FROM registration_audit").get().n, 1);
});
test("old-schema applications still register, expose no preference capability and require explicit migration", async t => {
  const f = await apiFixture(t);
  f.db.exec("DROP TABLE notification_outbox; DROP TABLE notification_preferences;");
  assert.equal((await f.request("/calendar", { token: f.one })).body.notificationsAvailable, false);
  assert.equal((await f.request("/games/1/entry", { method: "POST", token: f.one, body: { partnerId: null } })).status, 200);
  assert.equal((await f.request("/email/preferences", { token: f.one })).status, 503);
});
test("SMTP configuration is explicit, fixed sender/host, implicit TLS and disabled by default", () => {
  const env = { EMAIL_ENABLED: "1", DB_PATH: "/private/club.sqlite", SMTP_PASSWORD: "Fictional-test-password" };
  assert.throws(() => mailConfiguration({}), /disabled/);
  assert.throws(() => mailConfiguration({ ...env, DB_PATH: "relative.sqlite" }), /absolute/);
  assert.throws(() => mailConfiguration({ ...env, SMTP_HOST: "attacker.test" }), /requires/);
  assert.throws(() => mailConfiguration({ ...env, SMTP_PORT: "587" }), /implicit TLS/);
  assert.throws(() => mailConfiguration({ ...env, SMTP_USER: "other@example.test" }), /SMTP_USER/);
  assert.throws(() => mailConfiguration({ ...env, CABC_SITE_URL: "http://cabc.club" }), /HTTPS/);
  assert.throws(() => mailConfiguration({ ...env, MAIL_BATCH_SIZE: "21" }), /1 to 20/);
  const config = mailConfiguration(env);
  assert.equal(config.host, "mail.cabc.club"); assert.equal(config.port, 465); assert.equal(config.secure, true);
});
test("worker rechecks opt-out, active status, recipient address and age before sending", async t => {
  for (const mutation of ["optout", "inactive", "address", "expired"]) {
    const f = fixture(t); queueOne(f);
    if (mutation === "optout") setPreference(f.db, f.ids["Member One"], false);
    if (mutation === "inactive") f.db.prepare("UPDATE members SET active=0 WHERE id=?").run(f.ids["Member One"]);
    if (mutation === "address") f.db.prepare("UPDATE members SET email='changed@example.test' WHERE id=?").run(f.ids["Member One"]);
    if (mutation === "expired") f.db.prepare("UPDATE notification_outbox SET created_at=0").run();
    await processQueue(f.db, { transport: { sendMail() { assert.fail("Must not send"); } } });
    assert.equal(f.db.prepare("SELECT state FROM notification_outbox").get().state, "skipped");
  }
});
test("worker records successful sends with private opt-out links and a stable message ID", async t => {
  const f = fixture(t); queueOne(f);
  const sent = [];
  await processQueue(f.db, { transport: { async sendMail(message) { sent.push(message); } } });
  assert.equal(sent.length, 1); assert.equal(sent[0].to, "1@example.test");
  assert.equal(sent[0].from.address, "calendar@cabc.club");
  assert.match(sent[0].text, /#email-opt-out\/[a-f0-9]{64}/);
  assert.match(sent[0].messageId, /^<[a-f0-9]{32}@cabc.club>$/);
  assert.equal(f.db.prepare("SELECT state FROM notification_outbox").get().state, "sent");
  await processQueue(f.db, { transport: { sendMail() { assert.fail("No duplicate"); } } });
});
test("delayed registration cannot be sent after cancellation or a schedule change", async t => {
  for (const change of ["cancel", "time"]) {
    const f = fixture(t); queueOne(f);
    if (change === "cancel") f.db.prepare("DELETE FROM entries").run();
    else f.db.prepare("UPDATE games SET time='12:30'").run();
    await processQueue(f.db, { transport: { sendMail() { assert.fail("Stale snapshot"); } } });
    assert.equal(f.db.prepare("SELECT state FROM notification_outbox").get().state, "skipped");
  }
});
test("temporary SMTP failures stop after the fifth attempt", async t => {
  const f = fixture(t); queueOne(f);
  f.db.prepare("UPDATE notification_outbox SET attempts=4").run();
  await processQueue(f.db, { transport: { verify() { throw { code: "ECONNECTION", command: "CONN" }; }, sendMail() { assert.fail(); } } });
  assert.equal(f.db.prepare("SELECT state FROM notification_outbox").get().state, "failed");
});
test("database and email queue cannot be placed in public_html or configured PUBLIC_DIR", t => {
  const f = fixture(t);
  assert.throws(() => privateFile(path.join(f.directory, "public_html", "club.sqlite")), /outside public/);
  const previous = process.env.PUBLIC_DIR;
  try {
    process.env.PUBLIC_DIR = path.join(f.directory, "webroot");
    assert.throws(() => privateFile(path.join(f.directory, "webroot", "club.sqlite")), /outside public/);
    assert.equal(privateFile(f.filename), f.filename);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_DIR; else process.env.PUBLIC_DIR = previous;
  }
});
test("worker retries safe connection failures but quarantines ambiguous DATA and permanent errors", async t => {
  for (const [error, state, stage] of [
    [{ code: "ECONNECTION", command: "CONN" }, "pending", "verify"],
    [{ code: "EAUTH", command: "AUTH PLAIN" }, "failed", "send"],
    [{ responseCode: 550, command: "RCPT TO" }, "failed", "send"],
    [{ responseCode: 450, command: "DATA" }, "pending", "send"],
    [{ code: "ECONNECTION", command: "CONN" }, "uncertain", "send"],
    [{ code: "ETIMEDOUT", command: "DATA" }, "uncertain", "send"]
  ]) {
    const f = fixture(t); queueOne(f);
    const fail = () => { throw Object.assign(new Error("SECRET-PASSWORD-MUST-NOT-LOG"), error); };
    await processQueue(f.db, { transport: { async verify() { if (stage === "verify") fail(); }, async sendMail() { fail(); } } });
    const row = f.db.prepare("SELECT * FROM notification_outbox").get();
    assert.equal(row.state, state); assert.equal(row.attempts, 1);
    assert.doesNotMatch(row.last_error, /SECRET/);
    assert.ok(row.next_attempt > row.created_at);
  }
});
test("overlapping workers do not send twice; expired in-flight claims require manual review", async t => {
  const f = fixture(t); queueOne(f);
  let release; const barrier = new Promise(resolve => { release = resolve; });
  let started; const ready = new Promise(resolve => { started = resolve; });
  const first = processQueue(f.db, { transport: { async sendMail() { started(); await barrier; } } });
  await ready;
  assert.equal((await processQueue(f.db, { transport: { sendMail() { assert.fail("Second sender"); } } })).busy, true);
  release(); await first;
  f.db.prepare("UPDATE notification_outbox SET state='sending',locked_until=0").run();
  await processQueue(f.db, { transport: { sendMail() { assert.fail("Uncertain must not resend"); } } });
  assert.equal(f.db.prepare("SELECT state FROM notification_outbox").get().state, "uncertain");
});
test("preview database can never reach a transport; runtime uses TLS verification and bounded timeouts", async t => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO metadata VALUES('preview','1')").run();
  let created = false;
  const env = { EMAIL_ENABLED: "1", DB_PATH: f.filename, SMTP_PASSWORD: "Fictional-test-password" };
  await assert.rejects(runWorker({ env, createTransport() { created = true; } }), /preview/);
  assert.equal(created, false);
  await assert.rejects(processQueue(f.db, { transport: { sendMail() { assert.fail(); } } }), /preview/);
  f.db.prepare("DELETE FROM metadata WHERE key='preview'").run();
  queueOne(f);
  await runWorker({ env, createTransport(options) {
    assert.equal(options.secure, true); assert.equal(options.tls.rejectUnauthorized, true);
    assert.equal(options.logger, false); assert.equal(options.debug, false);
    assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
    return { async sendMail() {}, close() {} };
  } });
});
test("plaintext templates distinguish availability states, prevent header newlines and require opt-out confirmation", t => {
  const f = fixture(t);
  for (const [partner, text] of [["-Unavailable-", /not registered to play/], ["-Standby-", /Standby/], ["-Guest-", /with a guest/]]) {
    const result = renderMail({ kind: "registered", memberName: "QA", partner, game: { ...f.game, name: "Game\r\nBcc: victim" }, actorName: "Admin", delegated: true }, "a".repeat(64));
    assert.match(result.text, text); assert.doesNotMatch(result.subject, /[\r\n]/);
    assert.match(result.text, /Changed by Admin/); assert.match(result.text, /open this link and confirm/);
  }
});
test("Nodemailer delivers only to an isolated authenticated TLS SMTP fixture", async t => {
  const f = fixture(t), keyFile = path.join(f.directory, "key.pem"), certFile = path.join(f.directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile,
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-days", "1"], { stdio: "ignore" });
  const received = [];
  const server = tls.createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, socket => {
    let buffer = "", data = false, message = "";
    socket.write("220 localhost fixture\r\n");
    socket.on("data", chunk => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") { received.push(message); data = false; socket.write("250 accepted\r\n"); }
          else message += line + "\r\n";
        } else if (/^EHLO/.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN /.test(line)) {
          assert.match(Buffer.from(line.slice(11), "base64").toString(), /fake-password/);
          socket.write("235 authenticated\r\n");
        } else if (/^(MAIL FROM|RCPT TO)/.test(line)) socket.write("250 ok\r\n");
        else if (line === "DATA") { data = true; socket.write("354 continue\r\n"); }
        else if (line === "QUIT") { socket.end("221 bye\r\n"); }
        else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const transport = nodemailer.createTransport({ host: "127.0.0.1", port: server.address().port, secure: true,
    auth: { user: "calendar@cabc.club", pass: "fake-password" }, tls: { ca: readFileSync(certFile), servername: "localhost" } });
  queueOne(f); await processQueue(f.db, { transport }); transport.close();
  assert.equal(received.length, 1); assert.match(received[0], /From: CABC Calendar <calendar@cabc.club>/);
  assert.match(received[0], /To: 1@example.test/); assert.match(received[0], /Message-ID:/i);
  assert.equal(f.db.prepare("SELECT state FROM notification_outbox").get().state, "sent");
});
