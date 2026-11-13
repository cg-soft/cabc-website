import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { openDatabase } from "./db.mjs";
import { createApp } from "./server.mjs";
import { PDF_ASSETS } from "./pdf-assets.mjs";
import { createPdfViewer, rasterSize } from "./public/pdf-viewer.mjs";

const turn = () => new Promise(resolve => setImmediate(resolve));
async function settled() { await turn(); await turn(); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Node {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this.events = {};
    this.style = {}; this.value = ""; this.isConnected = true; this.clientWidth = 600;
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || "") + this.children.map(child => child.textContent).join(" "); }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this; this.children.push(node);
      if (this.tag === "select" && !this.value) this.value = node.value;
    }
  }
  replaceChildren(...nodes) { this.children = []; this.text = ""; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.isConnected = false; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(key, handler) { this.events[key] = handler; }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolls = (this.scrolls || 0) + 1; }
  getContext() { return {}; }
  async click() { if (!this.disabled) await this.events.click?.(); await settled(); }
}
function readerFixture(t, changes = {}) {
  const globals = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { createElement: tag => new Node(tag) };
  globalThis.window = { devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} };
  const container = new Node("div"), requests = [], tasks = [];
  let destroyed = 0, closed = 0, downloaded = 0, current = true;
  const engine = {
    getDocument(options) {
      requests.push(options);
      return { promise: Promise.resolve({
        numPages: 3,
        getPage: changes.getPage || (async number => ({
          getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
          render: params => {
            const task = { promise: Promise.resolve(), cancel() { this.cancelled = true; }, params };
            tasks.push(task); return task;
          },
          getTextContent: async () => ({ items: [{ str: `Private text ${number}`, hasEOL: true }] }),
          cleanup() {}
        }))
      }), destroy: async () => { destroyed++; } };
    }
  };
  const viewer = createPdfViewer({ container, title: "<Private title>", isCurrent: () => current,
    loadEngine: changes.loadEngine || (async () => engine),
    loadBytes: changes.loadBytes || (async () => new Uint8Array([37, 80, 68, 70]).buffer),
    onClose: () => { closed++; }, onDownload: async () => { downloaded++; } });
  t.after(() => { viewer.destroy(); globalThis.document = globals.document; globalThis.window = globals.window; });
  const button = text => container.querySelectorAll("button").find(node => node.textContent === text);
  return { viewer, container, requests, tasks, button, get destroyed() { return destroyed; },
    get closed() { return closed; }, get downloaded() { return downloaded; }, invalidate() { current = false; } };
}

test("PDF raster dimensions bound memory and edge lengths for small, retina and extreme pages", () => {
  for (const [w, h, ratio] of [[600, 800, 1], [2000, 3000, 4], [1, 1e9, 2], [1e9, 1, 2]]) {
    const size = rasterSize(w, h, ratio);
    assert.ok(size.width <= 8192 && size.height <= 8192);
    assert.ok(size.width * size.height <= 8000000);
    assert.ok(size.width >= 1 && size.height >= 1);
  }
  for (const params of [[0, 10], [10, -1], [NaN, 1], [1, Infinity], [10, 10, 0]])
    assert.throws(() => rasterSize(...params), /dimensions/);
});
test("in-page reader: page navigation, bounds, zoom, text, back, download and cleanup", async t => {
  const f = readerFixture(t); await settled();
  assert.match(f.container.textContent, /Page 1 of 3/);
  const reader = f.container.children[0];
  assert.equal(reader.scrolls, 1);
  assert.equal(f.container.querySelectorAll("h2")[0].textContent, "<Private title>");
  assert.equal(f.button("Previous").disabled, true);
  assert.equal(f.button("Next").disabled, false);
  assert.match(f.container.querySelectorAll("details")[0].textContent, /Private text 1/);
  assert.deepEqual([...f.requests[0].data], [37, 80, 68, 70]);
  for (const key of ["isEvalSupported", "useWasm", "enableXfa", "useSystemFonts", "useWorkerFetch", "isOffscreenCanvasSupported"])
    assert.equal(f.requests[0][key], false);
  assert.equal(f.requests[0].disableFontFace, true);
  assert.match(f.requests[0].cMapUrl, /pdfjs-6\.5\.438\/cmaps\/$/);
  await f.button("Next").click(); assert.match(f.container.textContent, /Page 2 of 3/);
  await f.button("Next").click(); assert.match(f.container.textContent, /Page 3 of 3/);
  assert.equal(f.button("Next").disabled, true);
  await f.button("Previous").click(); assert.match(f.container.textContent, /Page 2 of 3/);
  const input = f.container.querySelectorAll("input")[0];
  for (const invalid of ["", "0", "4", "1.5", "NaN"]) {
    input.value = invalid; input.events.change(); assert.equal(input.value, "2");
  }
  input.value = "1"; input.events.change(); await settled();
  const select = f.container.querySelectorAll("select")[0];
  select.value = "2"; select.events.change(); await settled();
  assert.equal(f.tasks.at(-1).params.viewport.width, 1600);
  select.value = "fit"; select.events.change(); await settled();
  assert.equal(f.tasks.at(-1).params.viewport.width, 568);
  assert.equal(reader.scrolls, 1);
  await f.button("Download PDF").click(); assert.equal(f.downloaded, 1);
  await f.button("Back to documents").click(); assert.equal(f.closed, 1);
  const canvas = f.container.querySelectorAll("canvas")[0];
  const text = f.container.querySelectorAll("details")[0];
  f.viewer.destroy(); f.viewer.destroy();
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  assert.doesNotMatch(text.textContent, /Private text/);
  assert.equal(f.container.children.length, 0); assert.equal(f.destroyed, 1);
});
test("leaving during a slow PDF byte fetch cannot create a parser or private canvas", async t => {
  const wait = deferred();
  const f = readerFixture(t, { loadBytes: () => wait.promise });
  f.viewer.destroy(); wait.resolve(new Uint8Array([1, 2]).buffer); await settled();
  assert.equal(f.requests.length, 0); assert.equal(f.container.children.length, 0);
});
test("leaving during slow page loading cancels the document and suppresses late pages", async t => {
  const wait = deferred();
  const f = readerFixture(t, { getPage: () => wait.promise }); await settled();
  f.viewer.destroy();
  wait.resolve({ cleanup() {}, getViewport() { throw new Error("Stale page must not render"); } });
  await settled();
  assert.equal(f.destroyed, 1); assert.equal(f.container.children.length, 0);
});
test("invalidated identity suppresses a late renderer-library response", async t => {
  const wait = deferred();
  const f = readerFixture(t, { loadEngine: () => wait.promise });
  f.invalidate(); wait.resolve({ getDocument() { throw new Error("Must not parse"); } }); await settled();
  assert.equal(f.requests.length, 0); assert.equal(f.container.querySelectorAll("canvas").length, 0);
});
test("PDF/library errors retain Back and Download without any popup fallback", async t => {
  const f = readerFixture(t, { loadEngine: async () => { throw new Error("Unavailable"); } }); await settled();
  assert.match(f.container.textContent, /could not be displayed/);
  assert.equal(f.container.querySelectorAll("canvas").length, 0);
  await f.button("Download PDF").click(); await f.button("Back to documents").click();
  assert.equal(f.downloaded, 1); assert.equal(f.closed, 1);
});
test("password-protected PDF rendering errors are explained in-page", async t => {
  const f = readerFixture(t, { loadEngine: async () => ({ getDocument: () => ({
    promise: Promise.reject(Object.assign(new Error("Password"), { name: "PasswordException" })), destroy: async () => {}
  }) }) }); await settled();
  assert.match(f.container.textContent, /requires a password/);
  assert.equal(f.button("Download PDF").disabled, undefined);
});
test("viewer source never opens native PDF windows or uses persistent storage; app guards stale list/session responses", () => {
  const app = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("./public/pdf-viewer.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(app + viewer, /window\.open|<iframe|<object|<embed|localStorage|sessionStorage|indexedDB/);
  assert.match(app, /documentOpenRevision !== openRevision/);
  assert.match(app, /!documentViewOpen/);
  assert.match(app, /sessionIdentity\(\) === requestIdentity/);
  assert.match(viewer, /globalThis\.pdfjsWorker = worker/);
  assert.doesNotMatch(viewer, /https?:\/\//);
});
test("PDF assets: exact allowlist, byte-identical public delivery, MIME, HEAD, private/unknown paths denied", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-pdf-assets-"));
  const db = openDatabase(path.join(directory, "test.sqlite"), true), server = createApp({ db });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); rmSync(directory, { recursive: true, force: true }); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const disk = readdirSync(new URL("./public/vendor/", import.meta.url), { recursive: true })
    .filter(file => /\.(mjs|js|bcmap|pfb|ttf)$/.test(file) || /(^|\/)LICENSE[^/]*$/.test(file))
    .map(file => "/vendor/" + file).sort();
  assert.deepEqual([...PDF_ASSETS].sort(), disk);
  assert.equal(PDF_ASSETS.size, 194);
  for (const route of ["/pdf-viewer.mjs", ...PDF_ASSETS]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(new URL("./public" + route, import.meta.url)));
    assert.match(response.headers.get("content-type"), /\.(m?js)$/.test(route) ? /^text\/javascript/ :
      /LICENSE[^/]*$/.test(route) ? /^text\/plain/ : /^application\/octet-stream$/);
  }
  const head = await fetch(base + "/pdf-viewer.mjs", { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal((await head.text()).length, 0);
  for (const route of ["/pdf-assets.mjs", "/vendor/pdfjs-6.5.438/private.txt", "/vendor/pdfjs-6.5.438/cmaps/private.bcmap",
    "/vendor/pdfjs-6.5.438/quickjs-eval.js", "/vendor/pdfjs-6.5.438/../../server.mjs", "/__proto__", "/constructor"])
    assert.equal((await fetch(base + route)).status, 404, route);
});
