import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { openDatabase } from "./db.mjs";
import { createApp } from "./server.mjs";

const asset = name => readFileSync(new URL(`./public/${name}`, import.meta.url));
const helperSource = asset("web-app.js").toString();
const appSource = asset("app.js").toString();
const manifest = JSON.parse(asset("manifest.webmanifest"));

function helperModel({ apple = false, display = false, hash = "", online = true } = {}) {
  const classes = new Set(), handlers = {}, notice = { hidden: true };
  const window = {
    navigator: { standalone: apple, onLine: online },
    matchMedia: query => ({ matches: query === "(display-mode: standalone)" && display }),
    location: { hash },
    history: { replaceState(_state, _title, value) { window.location.hash = value; } },
    addEventListener(name, handler) { handlers[name] = handler; }
  };
  vm.runInNewContext(helperSource, {
    window,
    document: {
      documentElement: { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } },
      querySelector: selector => selector === "#network-notice" ? notice : null
    }
  });
  return { window, classes, handlers, notice };
}

test("manifest keeps the calendar launch and assets inside relative app scope", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.short_name, "CABC Calendar");
  for (const base of ["https://example.test/manifest.webmanifest", "https://example.test/club/manifest.webmanifest"]) {
    const scope = new URL(manifest.scope, base);
    const start = new URL(manifest.start_url, base);
    assert.equal(start.origin, scope.origin);
    assert.equal(start.pathname, scope.pathname);
    assert.equal(start.hash, "#calendar");
    assert.equal(new URL(manifest.id, base).pathname, scope.pathname);
    for (const icon of manifest.icons) assert.ok(new URL(icon.src, base).pathname.startsWith(scope.pathname));
  }
});

test("home-screen icons are real opaque RGB PNGs in the declared dimensions", () => {
  for (const [name, size] of [["apple-touch-icon.png", 180], ["app-icon-192.png", 192], ["app-icon-512.png", 512]]) {
    const bytes = asset(name);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
    assert.equal(bytes[25], 2, "RGB without an alpha channel");
  }
});

test("HTML links Apple and manifest metadata and loads the helper before the app", () => {
  const html = asset("index.html").toString();
  assert.match(html, /name="viewport"[^>]+viewport-fit=cover/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-title" content="CABC Calendar"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\.\/apple-touch-icon.png"/);
  assert.match(html, /rel="manifest" href="\.\/manifest.webmanifest"/);
  assert.ok(html.indexOf('src="./web-app.js"') < html.indexOf('src="./app.js"'));
  assert.match(html, /id="network-notice"[^>]*role="status"[^>]*hidden/);
});

for (const [label, options] of [
  ["Safari navigator.standalone", { apple: true }],
  ["manifest display-mode", { display: true }]
]) {
  test(`${label} opens the calendar instead of the public homepage`, () => {
    for (const hash of ["", "#", "#home"]) {
      const model = helperModel({ ...options, hash });
      assert.equal(model.window.location.hash, "#calendar");
      assert.equal(model.classes.has("standalone-app"), true);
    }
  });
}
test("standalone launch preserves explicit login, about and calendar routes", () => {
  for (const hash of ["#login", "#about", "#calendar"]) assert.equal(helperModel({ apple: true, hash }).window.location.hash, hash);
});
test("ordinary Safari/desktop launches keep the public home and install help", () => {
  const model = helperModel();
  assert.equal(model.window.location.hash, "");
  assert.equal(model.classes.has("standalone-app"), false);
  assert.equal(model.notice.hidden, true);
});
test("offline notice follows initial state, reconnect and another disconnect", () => {
  const model = helperModel({ apple: true, online: false });
  assert.equal(model.notice.hidden, false);
  assert.equal(model.classes.has("is-offline"), true);
  model.window.navigator.onLine = true; model.handlers.online();
  assert.equal(model.notice.hidden, true);
  assert.equal(model.classes.has("is-offline"), false);
  model.window.navigator.onLine = false; model.handlers.offline();
  assert.equal(model.notice.hidden, false);
});
test("web app never introduces client-side credential/data storage or a service worker", () => {
  assert.doesNotMatch(helperSource + appSource, /localStorage|sessionStorage|indexedDB|serviceWorker|caches\.open|document\.cookie\s*=/);
  assert.match(appSource, /token: null/);
  assert.match(asset("style.css").toString(), /\.standalone-app \.install-help\{display:none\}/);
  assert.match(asset("style.css").toString(), /env\(safe-area-inset-top/);
  assert.match(asset("style.css").toString(), /env\(safe-area-inset-bottom/);
});

function appModel({ online = true, failedFetch = false } = {}) {
  const windowHandlers = {}, handlers = {}, requests = [];
  const container = { isConnected: true, innerHTML: "", setAttribute() {} };
  const dialog = { open: false, addEventListener() {}, querySelector: () => ({ setAttribute() {} }), showModal() { this.open = true; } };
  const document = {
    hidden: false,
    querySelector: selector => selector === "#dialog" ? dialog : selector === "#calendar-content" ? container : {},
    addEventListener(name, handler) { handlers[name] = handler; }
  };
  const window = {
    navigator: { onLine: online },
    addEventListener(name, handler) { windowHandlers[name] = handler; }
  };
  const sandbox = {
    document, window, location: { hash: "#calendar" }, console,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (failedFetch) throw new TypeError("Network failure");
      // loadCalendar stops before drawing; assertions below test guards and requests.
      return { ok: false, status: 503, json: async () => ({ error: "Test unavailable" }) };
    }
  };
  const end = "  route();\n})();";
  assert.ok(appSource.endsWith(`${end}\n`));
  vm.runInNewContext(appSource.replace(end, "  window.model = {state, api, refreshVisibleCalendar};\n})();"), sandbox);
  Object.assign(window.model.state, { user: { id: 1, name: "QA", role: "admin" }, token: "a".repeat(64), month: "2027-01", selected: "2027-01-11", actingMemberId: 2, config: { today: "2026-10-28" } });
  return { ...window.model, window, document, dialog, handlers, windowHandlers, requests, location: sandbox.location };
}
test("known-offline writes fail before fetch, without an offline queue", async () => {
  const model = appModel({ online: false });
  await assert.rejects(model.api("/games/1/entry", "POST", {}), /No changes have been sent/);
  assert.equal(model.requests.length, 0);
});
test("ambiguous network failure tells the user to check whether a save completed", async () => {
  const model = appModel({ failedFetch: true });
  await assert.rejects(model.api("/games/1/entry", "POST", {}), /check whether it was saved/);
  assert.equal(model.requests.length, 1);
  assert.equal(model.requests[0].options.cache, "no-store");
  assert.match(model.requests[0].options.headers.Authorization, /^Bearer /);
});
test("resume and reconnect load the current month without resetting selected target/date", async () => {
  const model = appModel();
  model.handlers.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.requests[0].url, "/api/calendar?month=2027-01");
  assert.equal(model.state.actingMemberId, 2);
  assert.equal(model.state.selected, "2027-01-11");
  model.windowHandlers.online();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.requests.length, 2);
  model.windowHandlers.pageshow({ persisted: false });
  assert.equal(model.requests.length, 2);
  model.windowHandlers.pageshow({ persisted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.requests.length, 3);
});
test("background refresh never interrupts forms, pending writes, hidden pages or sign-out", () => {
  for (const mode of ["dialog", "pending", "hidden", "signed-out", "other-page"]) {
    const model = appModel();
    if (mode === "dialog") model.dialog.open = true;
    if (mode === "pending") model.state.schedulingPending = true;
    if (mode === "hidden") model.document.hidden = true;
    if (mode === "signed-out") model.state.user = null;
    if (mode === "other-page") model.location.hash = "#about";
    model.refreshVisibleCalendar();
    assert.equal(model.requests.length, 0, mode);
  }
});
test("installation instructions describe Safari actions, sign-in and online-only behavior", async () => {
  const model = appModel();
  await model.handlers.click({ target: { closest: selector => selector === "[data-action]" ? { dataset: { action: "install-app" } } : null } });
  assert.equal(model.dialog.open, true);
  assert.match(model.dialog.innerHTML, /Safari/);
  assert.match(model.dialog.innerHTML, /Add to Home Screen/);
  assert.match(model.dialog.innerHTML, /Open as Web App/);
  assert.match(model.dialog.innerHTML, /fresh launch may require signing in again/);
});

test("server serves only allowlisted web-app assets with correct MIME and revalidation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cabc-webapp-"));
  const db = openDatabase(path.join(directory, "test.sqlite"), true);
  const server = createApp({ db });
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, mime] of [
      ["manifest.webmanifest", "application/manifest+json"],
      ["web-app.js", "text/javascript"],
      ["apple-touch-icon.png", "image/png"],
      ["app-icon-192.png", "image/png"],
      ["app-icon-512.png", "image/png"]
    ]) {
      const response = await fetch(`${base}/${name}`);
      assert.equal(response.status, 200, name);
      assert.ok(response.headers.get("content-type").startsWith(mime), name);
      assert.equal(response.headers.get("cache-control"), "no-cache");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), asset(name));
      const head = await fetch(`${base}/${name}`, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
    assert.equal((await fetch(`${base}/manifest.webmanifest`, { method: "POST" })).status, 405);
    for (const name of ["web-app-tests.mjs", "HOME-SCREEN.md", "data/club.sqlite", "unknown.png"]) {
      assert.equal((await fetch(`${base}/${name}`)).status, 404);
    }
    const api = await fetch(`${base}/api/calendar`);
    assert.equal(api.status, 401);
    assert.equal(api.headers.get("cache-control"), "no-store");
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
