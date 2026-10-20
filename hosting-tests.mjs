import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { ROOT, openDatabase, addMember } from "./db.mjs";

test("production hosting entry point", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cabc-hosting-"));
  const filename = path.join(directory, "club.sqlite");
  const children = [];
  function launch(env = {}, args = ["app.cjs"]) {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, PREVIEW_MODE: "", PREVIEW_TODAY: "", DB_PATH: filename, PORT: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.output = "";
    child.stdout.on("data", b => { child.output += b; });
    child.stderr.on("data", b => { child.output += b; });
    children.push(child);
    return child;
  }
  async function ready(child) {
    const until = Date.now() + 10000;
    while (!/CABC ready/.test(child.output)) {
      if (child.exitCode !== null || Date.now() > until) throw new Error(child.output || "Startup timeout");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try {
    await t.test("missing database fails without automatic initialization", async () => {
      const child = launch();
      assert.equal((await once(child, "exit"))[0], 1);
      assert.match(child.output, /not initialized/);
    });
    await t.test("preview mode is refused", async () => {
      const child = launch({ PREVIEW_MODE: "1" });
      assert.equal((await once(child, "exit"))[0], 1);
      assert.match(child.output, /does not allow preview/);
    });
    const db = openDatabase(filename, true);
    addMember(db, { name: "Hosting Test", email: "host@example.test", password: "Isolated-host-test-12345" }, "admin");
    db.close();
    await t.test("production serves assets, authentication, and no preview shortcuts", async () => {
      const child = launch();
      await ready(child);
      const port = /port (\d+)/.exec(child.output)[1];
      const base = `http://127.0.0.1:${port}`;
      assert.equal((await fetch(base)).status, 200);
      assert.equal((await (await fetch(base + "/api/config")).json()).preview, false);
      const result = await fetch(base + "/api/login", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "host@example.test", password: "Isolated-host-test-12345" }) });
      assert.equal(result.status, 200);
      const { token } = await result.json();
      const calendar = await fetch(base + "/api/calendar?month=2026-10", { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(calendar.status, 200);
      assert.deepEqual((await calendar.json()).games, []);
      for (const file of ["/app.cjs", "/db.mjs", "/data/club.sqlite", "/HOSTING.md"])
        assert.equal((await fetch(base + file)).status, 404);
      assert.equal((await fetch(base + "/api/preview", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: '{"role":"admin"}' })).status, 404);
      const exit = once(child, "exit"); child.kill("SIGTERM");
      assert.equal((await exit)[0], 0);
    });
    await t.test("Passenger-loaded startup invokes explicit passenger binding", async () => {
      // Exercise the loader contract, not a real Passenger installation.
      const child = launch({}, ["--input-type=commonjs", "-e", `
        const assert = require('node:assert/strict');
        const http = require('node:http');
        const listen = http.Server.prototype.listen;
        global.PhusionPassenger = { configure(options) { assert.equal(options.autoInstall, false); } };
        http.Server.prototype.listen = function(target, callback) {
          assert.equal(target, 'passenger');
          return listen.call(this, 0, '127.0.0.1', callback);
        };
        require('./app.cjs');
      `]);
      await ready(child);
      assert.match(child.output, /under Passenger/);
      const exit = once(child, "exit"); child.kill("SIGTERM");
      assert.equal((await exit)[0], 0);
    });
    await t.test("fictional preview database is refused even without preview mode", async () => {
      const db = openDatabase(filename);
      db.prepare("INSERT INTO metadata VALUES('preview','1')").run();
      db.close();
      const child = launch();
      assert.equal((await once(child, "exit"))[0], 1);
      assert.match(child.output, /fresh production database/);
    });
  } finally {
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});
