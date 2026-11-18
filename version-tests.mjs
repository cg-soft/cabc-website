import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import vm from "node:vm";
import { openDatabase } from "./db.mjs";
import { createApp } from "./server.mjs";
import { VERSION, SOURCE_FINGERPRINT } from "./release.mjs";
import { releaseFingerprint, stampRelease } from "./release-version.mjs";

const frontend = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
const frontendVersion = /const FRONTEND_VERSION = "([^"]+)";/.exec(frontend)[1];

function pageMarkup(renderer = "renderAbout", user = null) {
  const root = { innerHTML: "", querySelector: () => ({ isConnected: false }) };
  const sandbox = {
    window: { addEventListener() {}, CABC_API: "" },
    document: { querySelector: selector => selector === "#dialog" ? { addEventListener() {} } : root, addEventListener() {} },
    AbortController, setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ version: VERSION }) })
  };
  vm.runInNewContext(frontend.replace("  route();\n})();", `  state.user = ${JSON.stringify(user)};\n  ${renderer}();\n})();`), sandbox);
  return root.innerHTML;
}
const aboutMarkup = () => pageMarkup();

test("Help has two ordered sections, six independent collapsed screenshots and account-aware navigation", () => {
  const html = pageMarkup("renderHelp");
  assert.match(html, /id="help-sign-in">Sign in<\/h2><ol class="help-steps" start="1"/);
  assert.match(html, /id="help-register">Register with a partner<\/h2><ol class="help-steps" start="3"/);
  const panels = [...html.matchAll(/<details([^>]*)>([\s\S]*?)<\/details>/g)];
  assert.equal(panels.length, 6);
  for (const [index, [, attributes, details]] of panels.entries()) {
    assert.doesNotMatch(attributes, /\bopen\b/);
    assert.ok(details.includes(`./help/step-${index + 1}.png`));
    assert.match(details, /<img[^>]+alt="[^"]+"/);
  }
  assert.match(html, /Go to login/);
  assert.match(pageMarkup("renderHelp", { role: "member" }), /Back to calendar/);
});

test("About preserves the supplied club description and contact details", () => {
  const html = aboutMarkup();
  assert.match(html, /<main class="simple-page about-page"><h1>About the club<\/h1>/);
  assert.doesNotMatch(html, /<p class="eyebrow">Chinese American Bridge Club<\/p>/);
  const description = "The Chinese American Bridge Club is an invitational club offering sanctioned ACBL games every Monday at 11:30 AM. It is the oldest club in San Francisco, founded more than 65 years ago. Its uniqueness lies in the fact that it was founded as a social club to promote friendships throughout the community. Visitors are welcome but must be a guest of a member. If you are interested in playing or need more information, please email the club.";
  assert.ok(html.includes(`<p>${description}</p>`));
  for (const text of ["855 Brotherhood Way", "San Francisco, CA 94132", "C/O Masonic Brotherhood Center", "Sue Papilion", "Art Quey"])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes('href="mailto:Suepapilion@icloud.com">Suepapilion@icloud.com</a>'));
  assert.doesNotMatch(html, /More about the club will be added|We’re making a new home/);
});

test("About version diagnostics are inside a closed native disclosure on every render", () => {
  for (let visit = 0; visit < 2; visit++) {
    const html = aboutMarkup();
    const details = /<details([^>]*)>([\s\S]*?)<\/details>/.exec(html);
    assert.ok(details);
    assert.doesNotMatch(details[1], /\bopen\b/);
    assert.match(details[2], /<summary id="version-heading">Website version<\/summary>/);
    for (const attribute of ["data-backend-version", "data-backend-started", "data-version-status"])
      assert.ok(details[2].includes(attribute));
  }
});

test("About includes a separate closed dated change history after Website version", () => {
  for (let visit = 0; visit < 2; visit++) {
    const html = aboutMarkup();
    const panels = [...html.matchAll(/<details([^>]*)>([\s\S]*?)<\/details>/g)];
    assert.equal(panels.length, 2);
    assert.match(panels[0][2], /Website version/);
    assert.match(panels[1][2], /<summary id="changes-heading">Recent changes<\/summary>/);
    assert.doesNotMatch(panels[1][1], /\bopen\b/);
    const entries = [...panels[1][2].matchAll(/<li><time datetime="(\d{4}-\d{2}-\d{2})">([^<]+)<\/time><span>([^<]+)<\/span><\/li>/g)];
    assert.ok(entries.length >= 10);
    let previous = "9999-12-31";
    for (const [, date, label, summary] of entries) {
      assert.equal(label, date);
      assert.ok(Number.isFinite(Date.parse(`${date}T12:00:00Z`)));
      assert.ok(date <= previous, "Newest changes must appear first.");
      assert.ok(summary.length <= 100, "Keep each summary concise.");
      assert.doesNotMatch(summary, /[\r\n]/);
      previous = date;
    }
    assert.match(panels[1][2], /Dates refer to code changes, not installation dates/);
    assert.doesNotMatch(panels[0][2], /Recent changes|change-list/);
  }
});

test("each component is stamped and frontend records its expected backend", () => {
  assert.equal(SOURCE_FINGERPRINT, releaseFingerprint(), "Run npm run release:version after changing application code/assets.");
  const base = JSON.parse(readFileSync(new URL("./package.json", import.meta.url))).version;
  assert.equal(VERSION, `${base}+${SOURCE_FINGERPRINT.slice(0, 12)}`);
  assert.equal(frontendVersion, `${base}+${releaseFingerprint(undefined, "frontend").slice(0, 12)}`);
  assert.ok(frontend.includes(`const EXPECTED_BACKEND_VERSION = "${VERSION}";`));
  assert.throws(() => releaseFingerprint(undefined, "invalid"), /Unknown release scope/);
});

function releaseFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "cabc-stamp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "public"));
  writeFileSync(path.join(root, "package.json"), '{"version":"1.0.1"}');
  writeFileSync(path.join(root, "server.mjs"), "// backend\n");
  writeFileSync(path.join(root, "public/app.js"),
    'const FRONTEND_VERSION = "initial";\nconst EXPECTED_BACKEND_VERSION = "initial";\n');
  writeFileSync(path.join(root, "public/style.css"), "body{}\n");
  return root;
}

test("public-only stamping changes frontend, never backend metadata or its mtime", t => {
  const root = releaseFixture(t);
  const initial = stampRelease(root);
  assert.deepEqual(stampRelease(root), initial, "stamping alone never changes either fingerprint");
  const metadata = path.join(root, "release.mjs"), contents = readFileSync(metadata, "utf8");
  const modified = statSync(metadata, { bigint: true }).mtimeNs;
  for (const file of ["public/app.js", "public/style.css"]) {
    const previous = stampRelease(root);
    writeFileSync(path.join(root, file), readFileSync(path.join(root, file), "utf8") + "\n");
    const next = stampRelease(root);
    assert.notEqual(next.frontend, previous.frontend, file);
    assert.equal(next.backend, initial.backend, file);
    assert.equal(readFileSync(metadata, "utf8"), contents);
    assert.equal(statSync(metadata, { bigint: true }).mtimeNs, modified);
  }
  const current = stampRelease(root);
  writeFileSync(path.join(root, "notes.md"), "documentation only");
  writeFileSync(path.join(root, "public/config.js"), "deployment settings");
  writeFileSync(path.join(root, "release-version.mjs"), "// development tool only\n");
  assert.deepEqual(stampRelease(root), current);
});

test("backend edits change only the backend stamp and embedded backend expectation", t => {
  const root = releaseFixture(t), before = stampRelease(root);
  writeFileSync(path.join(root, "server.mjs"), "// changed backend\n");
  const after = stampRelease(root);
  assert.notEqual(after.backend, before.backend);
  assert.equal(after.frontend, before.frontend, "backend metadata is not frontend source code");
  assert.ok(readFileSync(path.join(root, "public/app.js"), "utf8")
    .includes(`const EXPECTED_BACKEND_VERSION = "${after.backend}";`));
  const repeated = stampRelease(root);
  assert.deepEqual(repeated, after);
});

test("new nested public assets change only the frontend stamp", t => {
  const root = releaseFixture(t), before = stampRelease(root);
  mkdirSync(path.join(root, "public/images"));
  writeFileSync(path.join(root, "public/images/example.svg"), "<svg/>");
  const after = stampRelease(root);
  assert.notEqual(after.frontend, before.frontend);
  assert.equal(after.backend, before.backend);
});

test("a running server serves a frontend-only update without changing backend version/start time", async t => {
  const root = releaseFixture(t), before = stampRelease(root);
  const dbDir = mkdtempSync(path.join(tmpdir(), "cabc-running-version-"));
  const db = openDatabase(path.join(dbDir, "club.sqlite"), true);
  const server = createApp({ db, publicDir: path.join(root, "public") });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    db.close(); rmSync(dbDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const backendBefore = await (await fetch(`${base}/api/version`)).json();
  assert.ok((await (await fetch(`${base}/app.js`)).text()).includes(before.frontend));
  writeFileSync(path.join(root, "public/app.js"), readFileSync(path.join(root, "public/app.js"), "utf8") + "// website-only edit\n");
  const after = stampRelease(root);
  assert.notEqual(after.frontend, before.frontend); assert.equal(after.backend, before.backend);
  assert.ok((await (await fetch(`${base}/app.js`)).text()).includes(after.frontend));
  assert.deepEqual(await (await fetch(`${base}/api/version`)).json(), backendBefore);
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
  for (let step = 1; step <= 6; step++) {
    const filename = `/help/step-${step}.png`;
    const asset = await fetch(base + filename);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), readFileSync(new URL(`./public${filename}`, import.meta.url)));
  }
  for (const filename of ["/help/step-1.webp", "/help/step-2.webp", "/help/step-3.webp", "/help/step-7.png", "/help/cabc.club.pdf", "/cabc.club.pdf"])
    assert.equal((await fetch(base + filename)).status, 404);
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
  ["expected independent", { ok: true, json: async () => ({ version: VERSION, startedAt: "2026-10-30T12:00:00.000Z" }) }, /Backend matches/],
  ["mismatched", { ok: true, json: async () => ({ version: "1.0.0+aaaaaaaaaaaa" }) }, /differs from the version expected/],
  ["frontend stamp incorrectly reported as backend", { ok: true, json: async () => ({ version: frontendVersion }) }, /differs from the version expected/],
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
