import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import vm from "node:vm";
import { openDatabase } from "./db.mjs";
import { createApp } from "./server.mjs";
import { VERSION, SOURCE_FINGERPRINT } from "./release.mjs";
import { releaseFingerprint, stampRelease } from "./release-version.mjs";

const frontend = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");

test("release identifiers match and runtime changes cannot silently keep an old stamp", () => {
  assert.equal(SOURCE_FINGERPRINT, releaseFingerprint(), "Run npm run release:version after changing application code/assets.");
  const base = JSON.parse(readFileSync(new URL("./package.json", import.meta.url))).version;
  assert.equal(VERSION, `${base}+${SOURCE_FINGERPRINT.slice(0, 12)}`);
  assert.ok(frontend.includes(`const FRONTEND_VERSION = "${VERSION}";`));
});

test("release stamping is deterministic and updates for backend, frontend and asset changes", t => {
  const root = mkdtempSync(path.join(tmpdir(), "cabc-stamp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "public"));
  writeFileSync(path.join(root, "package.json"), '{"version":"1.0.1"}');
  writeFileSync(path.join(root, "server.mjs"), "// backend\n");
  writeFileSync(path.join(root, "public/app.js"), 'const FRONTEND_VERSION = "initial";\n');
  writeFileSync(path.join(root, "public/style.css"), "body{}\n");
  const initial = stampRelease(root);
  assert.equal(stampRelease(root), initial, "stamping alone never changes the fingerprint");
  for (const file of ["server.mjs", "public/app.js", "public/style.css"]) {
    const previous = stampRelease(root);
    writeFileSync(path.join(root, file), readFileSync(path.join(root, file), "utf8") + "\n");
    assert.notEqual(stampRelease(root), previous, file);
  }
  const current = stampRelease(root);
  writeFileSync(path.join(root, "notes.md"), "documentation only");
  writeFileSync(path.join(root, "public/config.js"), "deployment settings");
  assert.equal(stampRelease(root), current);
});

test("version API is public, stable, uncached and exposes only version/start time", async t => {
  const dir = mkdtempSync(path.join(tmpdir(), "cabc-version-"));
  const db = openDatabase(path.join(dir, "club.sqlite"), true);
  const server = createApp({ db });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/version`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ["startedAt", "version"]);
  assert.equal(data.version, VERSION); assert.ok(Number.isFinite(Date.parse(data.startedAt)));
  assert.deepEqual(await (await fetch(`${base}/api/version`)).json(), data);
  assert.equal((await (await fetch(`${base}/api/config`)).json()).version, VERSION);
  assert.equal((await fetch(`${base}/api/calendar`)).status, 401);
  for (const file of ["release.mjs", "release-version.mjs", "version-tests.mjs"])
    assert.equal((await fetch(`${base}/${file}`)).status, 404);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM members").get().n, 0);
});

async function versionPanel(response, connected = true) {
  const nodes = new Map(["[data-backend-version]", "[data-backend-started]", "[data-version-status]"].map(k => [k, { textContent: "" }]));
  const panel = { isConnected: connected, querySelector: selector => nodes.get(selector) };
  const dialog = { dataset: {}, addEventListener() {} };
  const sandbox = {
    window: { addEventListener() {}, CABC_API: "" },
    document: { querySelector: selector => selector === "#dialog" ? dialog : {}, addEventListener() {} },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      assert.equal(url, "/api/version"); assert.equal(options.cache, "no-store");
      assert.equal(options.headers, undefined, "no authentication token is needed");
      if (response instanceof Error) throw response;
      return response;
    }
  };
  vm.runInNewContext(frontend.replace("  route();\n})();", "  window.checkVersion = loadBackendVersion;\n})();"), sandbox);
  await sandbox.window.checkVersion(panel);
  return [...nodes.values()].map(n => n.textContent);
}

for (const [name, response, expected] of [
  ["matching", { ok: true, json: async () => ({ version: VERSION, startedAt: "2026-10-30T12:00:00.000Z" }) }, /versions match/],
  ["mismatched", { ok: true, json: async () => ({ version: "1.0.0+aaaaaaaaaaaa" }) }, /Different frontend and backend/],
  ["legacy 404", { ok: false, status: 404 }, /older release/],
  ["legacy 401", { ok: false, status: 401 }, /older release/],
  ["server error", { ok: false, status: 500 }, /unavailable/],
  ["missing version", { ok: true, json: async () => ({}) }, /valid version/],
  ["untrusted value", { ok: true, json: async () => ({ version: "<script>bad</script>" }) }, /valid version/],
  ["network failure", new Error("Fictional network error"), /Unable to check/]
]) test(`About handles ${name} backend`, async () => {
  const values = await versionPanel(response);
  assert.match(values[2], expected);
  assert.equal(values.join("").includes("<script>"), false);
});

test("a late version response does not alter a page after navigation", async () => {
  assert.deepEqual(await versionPanel({ ok: true, json: async () => ({ version: VERSION }) }, false), ["", "", ""]);
});
