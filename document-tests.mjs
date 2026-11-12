import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { Readable, PassThrough } from "node:stream";
import { openDatabase, addMember, hashToken } from "./db.mjs";
import { createApp } from "./server.mjs";
import { migrateDocuments } from "./migrate.mjs";
import { configuration, setup, runBackup, restoreCopy } from "./backup.mjs";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_STORAGE, createDocumentHandler } from "./documents.mjs";

const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const password = "Document-fixture-password-2026";
async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-documents-"));
  const filename = path.join(directory, "club.sqlite");
  const db = openDatabase(filename, true);
  const ids = {};
  for (const [name, role] of [["Admin", "admin"], ["Member", "member"], ["Other Admin", "admin"]])
    ids[name] = addMember(db, { name, email: `${name.replaceAll(" ", "")}@example.test`, password }, role);
  const server = createApp({ db }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(route, { token, cookie, csrf, body, bytes, metadata, method = "GET", headers = {} } = {}) {
    const response = await fetch(base + route, { method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(bytes !== undefined ? { "Content-Type": "application/pdf", "X-Document-Metadata": encodeURIComponent(JSON.stringify(metadata)) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...headers },
      body: bytes !== undefined ? bytes : body !== undefined ? JSON.stringify(body) : undefined });
    const bytesOut = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, bytes: bytesOut,
      body: bytesOut.length && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytesOut) : null };
  }
  const login = (name, remembered = false) => request("/login", { method: "POST",
    body: { email: `${name.replaceAll(" ", "")}@example.test`, password, rememberDevice: remembered } });
  const admin = (await login("Admin")).body.token, member = (await login("Member")).body.token;
  const details = { title: "Club bulletin", description: "A private club PDF", filename: "bulletin.pdf" };
  const upload = (metadata = details, token = admin, bytes = pdf) =>
    request("/documents", { token, method: "POST", metadata, bytes });
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    db.close(); rmSync(directory, { recursive: true, force: true });
  });
  return { db, directory, filename, ids, request, admin, member, login, details, upload };
}

test("documents: visibility, mutation and protected file delivery", async t => {
  const f = await fixture(t);
  let privateDoc, sharedDoc;
  await t.test("anonymous access and regular-member writes fail; new documents default to admin-only", async () => {
    assert.equal((await f.request("/documents")).status, 401);
    assert.equal((await f.upload(f.details, f.member)).status, 403);
    const result = await f.upload(); assert.equal(result.status, 201); privateDoc = result.body.document;
    assert.equal(privateDoc.visibility, "admin"); assert.equal(privateDoc.content, undefined);
    assert.equal((await f.request("/documents", { token: f.admin })).body.documents.length, 1);
    assert.deepEqual((await f.request("/documents", { token: f.member })).body.documents, []);
  });
  await t.test("hidden documents cannot be read by guessing IDs, download URLs or delegated IDs", async () => {
    for (const suffix of ["/file", "/file?download=1", "/file?memberId=1"])
      assert.equal((await f.request(`/documents/${privateDoc.id}${suffix}`, { token: f.member })).status, 404);
    assert.equal((await f.request(`/documents/${privateDoc.id}/file`)).status, 401);
    assert.equal((await f.request(`/documents/${privateDoc.id}/file`, { token: f.member, method: "HEAD" })).status, 404);
    assert.equal((await f.request("/documents/9007199254740992/file", { token: f.admin })).status, 404);
  });
  await t.test("sharing requires an explicit boolean confirmation, never a default or string", async () => {
    for (const confirmPublish of [undefined, false, "true"])
      assert.equal((await f.upload({ ...f.details, visibility: "members", confirmPublish })).status, 400);
    const result = await f.upload({ ...f.details, title: "Member bulletin", visibility: "members", confirmPublish: true });
    assert.equal(result.status, 201); sharedDoc = result.body.document;
    const list = (await f.request("/documents", { token: f.member })).body.documents;
    assert.deepEqual(list.map(doc => doc.id), [sharedDoc.id]);
    assert.equal((await f.request("/documents", { token: f.admin })).body.documents.length, 2);
  });
  await t.test("file bytes are authenticated, exact, no-store and never use uploaded filenames as paths", async () => {
    const file = await f.request(`/documents/${sharedDoc.id}/file?download=1`, { token: f.member });
    assert.equal(file.status, 200); assert.deepEqual(file.bytes, pdf);
    assert.equal(file.headers.get("content-type"), "application/pdf");
    assert.equal(file.headers.get("cache-control"), "private, no-store");
    assert.match(file.headers.get("content-disposition"), /^attachment;/);
    assert.match(file.headers.get("content-security-policy"), /sandbox/);
    const head = await f.request(`/documents/${sharedDoc.id}/file`, { token: f.admin, method: "HEAD" });
    assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
    assert.equal(head.headers.get("content-length"), String(pdf.length));
  });
  await t.test("invalid metadata, paths, active PDFs and content types cannot create records", async () => {
    const count = f.db.prepare("SELECT count(*) AS n FROM documents").get().n;
    for (const metadata of [{ ...f.details, title: "" }, { ...f.details, title: "x".repeat(121) },
      { ...f.details, description: "x".repeat(1001) }, { ...f.details, visibility: "public" },
      { ...f.details, filename: "../secret.pdf" }, { ...f.details, filename: "x.html" },
      { ...f.details, filename: "bad\r\n.pdf" }])
      assert.equal((await f.upload(metadata)).status, 400);
    for (const bytes of [Buffer.from("<html>not a PDF</html>"), Buffer.from("%PDF-1.4\nmissing ending"),
      Buffer.from("%PDF-1.4\n/JavaScript /JS (alert)\n%%EOF\n"), Buffer.from("%PDF-1.4\n/J#61vaScript\n%%EOF\n")])
      assert.equal((await f.upload(f.details, f.admin, bytes)).status, 400);
    assert.equal((await f.request("/documents", { token: f.admin, method: "POST", body: f.details })).status, 415);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents").get().n, count);
  });
  await t.test("oversized bodies are rejected with JSON, including chunked uploads", async () => {
    const large = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
    assert.equal((await f.upload(f.details, f.admin, large)).status, 413);
    const request = Readable.from([large.subarray(0, 6000000), large.subarray(6000000)]);
    // The service-level reader also accepts streaming requests without Content-Length.
    const handler = createDocumentHandler({ db: f.db, authenticate: () => ({ id: f.ids.Admin, role: "admin" }) });
    request.headers = { "content-type": "application/pdf", "x-document-metadata": encodeURIComponent(JSON.stringify(f.details)) };
    request.method = "POST";
    await assert.rejects(handler(request, {}, new URL("http://local/api/documents"), { id: f.ids.Admin, role: "admin" }, () => {}),
      error => error.status === 413);
  });
  await t.test("metadata edits use revisions and require confirmation before widening access", async () => {
    const body = { title: "Renamed private PDF", description: "", visibility: "members", revision: privateDoc.revision };
    assert.equal((await f.request(`/documents/${privateDoc.id}`, { token: f.member, method: "PATCH", body })).status, 403);
    assert.equal((await f.request(`/documents/${privateDoc.id}`, { token: f.admin, method: "PATCH", body })).status, 400);
    const saved = await f.request(`/documents/${privateDoc.id}`, { token: f.admin, method: "PATCH", body: { ...body, confirmPublish: true } });
    assert.equal(saved.status, 200); privateDoc = saved.body.document;
    assert.equal((await f.request(`/documents/${privateDoc.id}/file`, { token: f.member })).status, 200);
    assert.equal((await f.request(`/documents/${privateDoc.id}`, { token: f.admin, method: "PATCH", body: { ...body, confirmPublish: true } })).status, 409);
  });
  await t.test("restricting visibility removes list and file access immediately", async () => {
    const saved = await f.request(`/documents/${privateDoc.id}`, { token: f.admin, method: "PATCH",
      body: { title: privateDoc.title, visibility: "admin", revision: privateDoc.revision } });
    assert.equal(saved.status, 200); privateDoc = saved.body.document;
    assert.equal((await f.request(`/documents/${privateDoc.id}/file`, { token: f.member })).status, 404);
    assert.ok(!(await f.request("/documents", { token: f.member })).body.documents.some(doc => doc.id === privateDoc.id));
  });
  await t.test("file replacement is atomic, revision checked and confirmation protected", async () => {
    const bytes = Buffer.from("%PDF-1.7\nReplacement bytes\n%%EOF\n");
    const metadata = { ...f.details, title: sharedDoc.title, visibility: "members", revision: sharedDoc.revision };
    assert.equal((await f.request(`/documents/${sharedDoc.id}/file`, { token: f.admin, method: "PUT", bytes, metadata })).status, 400);
    const result = await f.request(`/documents/${sharedDoc.id}/file`, { token: f.admin, method: "PUT", bytes, metadata: { ...metadata, confirmPublish: true } });
    assert.equal(result.status, 200); sharedDoc = result.body.document;
    assert.deepEqual((await f.request(`/documents/${sharedDoc.id}/file`, { token: f.member })).bytes, bytes);
    assert.equal((await f.request(`/documents/${sharedDoc.id}/file`, { token: f.admin, method: "PUT", bytes, metadata: { ...metadata, confirmPublish: true } })).status, 409);
  });
  await t.test("remembered sessions retain per-account visibility and enforce CSRF on every write", async () => {
    const login = await f.login("Admin", true), cookie = login.headers.get("set-cookie").split(";")[0];
    const data = { method: "POST", cookie, metadata: f.details, bytes: pdf };
    assert.equal((await f.request("/documents", data)).status, 403);
    assert.equal((await f.request("/documents", { ...data, csrf: login.body.csrfToken, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    assert.equal((await f.request("/documents", { ...data, csrf: login.body.csrfToken })).status, 201);
    const memberLogin = await f.login("Member", true), memberCookie = memberLogin.headers.get("set-cookie").split(";")[0];
    assert.equal((await f.request(`/documents/${privateDoc.id}/file`, { cookie: memberCookie })).status, 404);
    assert.equal((await f.request(`/documents/${sharedDoc.id}/file`, { cookie: memberCookie })).status, 200);
  });
  await t.test("failed audit storage rolls back document content and metadata together", async () => {
    const before = f.db.prepare("SELECT * FROM documents ORDER BY id").all();
    f.db.exec("CREATE TEMP TRIGGER fail_document_audit BEFORE INSERT ON document_audit BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    try { assert.equal((await f.upload()).status, 500); }
    finally { f.db.exec("DROP TRIGGER fail_document_audit"); }
    assert.deepEqual(f.db.prepare("SELECT * FROM documents ORDER BY id").all(), before);
  });
  await t.test("deletion needs confirmation and a current revision; audit retains no PDF bytes", async () => {
    const route = `/documents/${sharedDoc.id}`;
    assert.equal((await f.request(route, { token: f.admin, method: "DELETE", body: { revision: sharedDoc.revision } })).status, 400);
    assert.equal((await f.request(route, { token: f.admin, method: "DELETE", body: { revision: 0, confirm: true } })).status, 409);
    assert.equal((await f.request(route, { token: f.admin, method: "DELETE", body: { revision: sharedDoc.revision, confirm: true } })).status, 200);
    assert.equal((await f.request(`${route}/file`, { token: f.admin })).status, 404);
    assert.ok(f.db.prepare("SELECT id FROM document_audit WHERE document_id=? AND action='delete'").get(sharedDoc.id));
    assert.deepEqual(f.db.prepare("PRAGMA table_info(document_audit)").all().map(row => row.name),
      ["id", "created_at", "actor_id", "document_id", "action", "old_visibility", "new_visibility"]);
  });
  await t.test("expired, demoted and inactive accounts cannot keep privileged access", async () => {
    const admin = (await f.login("Other Admin")).body.token;
    f.db.prepare("UPDATE sessions SET expires=0 WHERE hash=?").run(hashToken(admin));
    assert.equal((await f.request("/documents", { token: admin })).status, 401);
    f.db.prepare("UPDATE members SET role='member' WHERE id=?").run(f.ids.Admin);
    assert.equal((await f.upload()).status, 403);
    assert.equal((await f.request(`/documents/${privateDoc.id}/file`, { token: f.admin })).status, 404);
    f.db.prepare("UPDATE members SET active=0 WHERE id=?").run(f.ids.Admin);
    assert.equal((await f.request("/documents", { token: f.admin })).status, 401);
  });
});

test("documents migration is additive, repeatable and retains legacy data", async t => {
  const f = await fixture(t);
  // Disposable fixture only: model a database created before documents existed.
  f.db.exec("DROP TABLE document_audit; DROP TABLE documents");
  assert.equal((await f.request("/documents", { token: f.admin })).status, 503);
  const result = migrateDocuments(f.filename);
  assert.equal(result.applied, true); assert.deepEqual(result.before, result.after);
  assert.equal(migrateDocuments(f.filename).applied, false);
  assert.equal((await f.upload()).status, 201);
  assert.equal(f.db.prepare("PRAGMA user_version").get().user_version, 1);
});

test("uploads reauthenticate after streaming and cap concurrent requests", async t => {
  const f = await fixture(t);
  let revoked = false;
  const actor = { id: f.ids.Admin, role: "admin" };
  const handler = createDocumentHandler({ db: f.db, authenticate: () => {
    if (revoked) throw Object.assign(new Error("Session revoked"), { status: 401 });
    return actor;
  } });
  function pendingRequest() {
    const req = new PassThrough();
    req.headers = { "content-type": "application/pdf", "x-document-metadata": encodeURIComponent(JSON.stringify(f.details)) };
    req.method = "POST";
    return req;
  }
  const first = pendingRequest(), second = pendingRequest();
  const url = new URL("http://local/api/documents");
  const a = handler(first, {}, url, actor, () => {});
  const b = handler(second, {}, url, actor, () => {});
  await assert.rejects(handler(pendingRequest(), {}, url, actor, () => {}), error => error.status === 429);
  revoked = true;
  const rejections = Promise.all([assert.rejects(a, error => error.status === 401),
    assert.rejects(b, error => error.status === 401)]);
  first.end(pdf); second.end(pdf);
  await rejections;
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents").get().n, 0);
  revoked = false;
  const next = pendingRequest(), saved = handler(next, {}, url, actor, () => {});
  next.end(pdf); await saved;
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents").get().n, 1);
});

test("maximum-sized PDF and total-storage quota boundaries", async t => {
  const f = await fixture(t);
  const bytes = Buffer.alloc(MAX_DOCUMENT_BYTES, " ");
  pdf.copy(bytes); Buffer.from("%%EOF\n").copy(bytes, bytes.length - 6);
  assert.equal((await f.upload(f.details, f.admin, bytes)).status, 201);
  const proxy = { exec: f.db.exec.bind(f.db), prepare: sql => sql.startsWith("SELECT coalesce(sum(size)")
    ? { get: () => ({ n: MAX_DOCUMENT_STORAGE }) } : f.db.prepare(sql) };
  const actor = { id: f.ids.Admin, role: "admin" };
  const handler = createDocumentHandler({ db: proxy, authenticate: () => actor });
  const req = Readable.from([pdf]);
  req.headers = { "content-type": "application/pdf", "x-document-metadata": encodeURIComponent(JSON.stringify(f.details)) };
  req.method = "POST";
  await assert.rejects(handler(req, {}, new URL("http://local/api/documents"), actor, () => {}), error => error.status === 409);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents").get().n, 1);
  const insert = f.db.prepare("INSERT INTO documents(title,filename,content,size,uploaded_by,created_at,updated_at) VALUES('Quota fixture','fixture.pdf',?,?,?,'2026-01-01','2026-01-01')");
  f.db.exec("BEGIN");
  try {
    for (let i = 0; i < 999; i++) insert.run(pdf, pdf.length, f.ids.Admin);
    f.db.exec("COMMIT");
  } catch (error) { f.db.exec("ROLLBACK"); throw error; }
  assert.equal((await f.upload()).status, 409);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents").get().n, 1000);
});

test("encrypted SQLite backups and restore copies include exact PDF bytes and visibility", async t => {
  const f = await fixture(t);
  const uploaded = await f.upload();
  assert.equal(uploaded.status, 201);
  const config = configuration({ DB_PATH: f.filename, BACKUP_DIR: path.join(f.directory, "backups"),
    BACKUP_KEY_PATH: path.join(f.directory, "key.hex") });
  setup(config);
  const encrypted = (await runBackup(config)).file;
  assert.ok(!readFileSync(encrypted).includes(pdf));
  const restoredFile = path.join(f.directory, "restored.sqlite");
  await restoreCopy(encrypted, restoredFile, config);
  const restored = openDatabase(restoredFile);
  try {
    const row = restored.prepare("SELECT * FROM documents").get();
    assert.equal(row.visibility, "admin"); assert.deepEqual(Buffer.from(row.content), pdf);
    assert.equal(row.title, f.details.title);
    assert.equal(restored.prepare("SELECT count(*) AS n FROM document_audit").get().n, 1);
  } finally { restored.close(); }
});
