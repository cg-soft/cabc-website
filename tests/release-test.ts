import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  cpSync,
} from "node:fs";
import { spawnSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import os from "node:os";
import { artifactFiles, sha256 } from "../script/release-utils";

const root = process.cwd();
const tsx = (file: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", file, ...args], {
    encoding: "utf8",
    cwd: root,
  });
  return { ...result, text: result.stdout + result.stderr };
};
const ok = (result: { status: number | null; text: string }) =>
  assert.equal(result.status, 0, result.text);
const digest = (file: string) => sha256(readFileSync(file));

test(
  "split builds, curated release packaging and isolated production runtime",
  { timeout: 180000 },
  async (t) => {
    const prefix = `qa-${Date.now()}`;
    const releases = ["full", "ui", "server", "runtime"].map((kind) =>
      path.join("release", `${prefix}-${kind}`),
    );
    const sandbox = mkdtempSync(path.join(os.tmpdir(), "cabc-production-"));
    const generated = [
      "dist/.htaccess",
      "dist/public/.htaccess",
      "dist/public/stale-test.txt",
      "client/public/release-test.txt",
    ];
    const previous = new Map(
      generated.filter(existsSync).map((file) => [file, readFileSync(file)]),
    );
    let server: ChildProcess | undefined;
    try {
      ok(tsx("script/build.ts"));
      await t.test(
        "UI build preserves server; server build preserves UI; both preserve hosting config",
        async () => {
          writeFileSync("dist/.htaccess", "# test parent configuration\n");
          writeFileSync("dist/public/.htaccess", "# test public configuration\n");
          writeFileSync("dist/public/stale-test.txt", "stale");
          const backend = digest("dist/index.cjs");
          const migration = digest("dist/migrate.cjs");
          ok(tsx("script/build.ts", "ui"));
          assert.equal(digest("dist/index.cjs"), backend);
          assert.equal(digest("dist/migrate.cjs"), migration);
          assert.equal(existsSync("dist/public/stale-test.txt"), false);
          const ui = Object.fromEntries(
            (await artifactFiles("ui")).map((file) => [file, digest(file)]),
          );
          ok(tsx("script/build.ts", "server"));
          assert.deepEqual(
            Object.fromEntries((await artifactFiles("ui")).map((file) => [file, digest(file)])),
            ui,
          );
          assert.equal(readFileSync("dist/.htaccess", "utf8"), "# test parent configuration\n");
          assert.equal(
            readFileSync("dist/public/.htaccess", "utf8"),
            "# test public configuration\n",
          );
        },
      );
      await t.test("packaging rejects stale source and altered artifacts", () => {
        writeFileSync("client/public/release-test.txt", "new source");
        assert.equal(tsx("script/release.ts", "ui", `${prefix}-stale`).status, 1);
        rmSync("client/public/release-test.txt");
        const original = readFileSync("dist/index.cjs");
        try {
          writeFileSync("dist/index.cjs", Buffer.concat([original, Buffer.from("\n// altered")]));
          assert.equal(tsx("script/release.ts", "server", `${prefix}-altered`).status, 1);
        } finally {
          writeFileSync("dist/index.cjs", original);
        }
      });
      await t.test(
        "release types contain only their required payloads and reject tampering",
        () => {
          for (const kind of ["full", "ui", "server", "runtime"]) {
            ok(tsx("script/release.ts", kind, `${prefix}-${kind}`));
            ok(tsx("script/verify-release.ts", `release/${prefix}-${kind}`));
            const manifest = JSON.parse(
              readFileSync(`release/${prefix}-${kind}/manifest.json`, "utf8"),
            );
            const files = Object.keys(manifest.files);
            assert.equal(
              files.some((f) => /htaccess|node_modules|\.env|private|\.sqlite/.test(f)),
              false,
            );
            if (kind === "ui") assert.ok(files.every((f) => f.startsWith("dist/public/")));
            if (kind === "server")
              assert.deepEqual(files.sort(), ["dist/index.cjs", "dist/migrate.cjs"]);
            if (kind === "runtime")
              assert.deepEqual(files.sort(), ["package-lock.json", "package.json"]);
          }
          assert.equal(
            tsx("script/release.ts", "full", `${prefix}-full`).status,
            1,
            "existing releases cannot be overwritten",
          );
          const runtimeManifest = `release/${prefix}-runtime/manifest.json`;
          ok(tsx("script/verify-release.ts", `release/${prefix}-full`, runtimeManifest));
          const incompatible = path.join(sandbox, "incompatible.json");
          const manifest = JSON.parse(readFileSync(runtimeManifest, "utf8"));
          writeFileSync(incompatible, JSON.stringify({ ...manifest, apiContract: 99 }));
          assert.equal(
            tsx("script/verify-release.ts", `release/${prefix}-ui`, incompatible).status,
            1,
          );
          writeFileSync(incompatible, JSON.stringify({ ...manifest, runtimeFingerprint: "wrong" }));
          assert.equal(
            tsx("script/verify-release.ts", `release/${prefix}-server`, incompatible).status,
            1,
          );
          const backend = `release/${prefix}-server/payload/dist/index.cjs`;
          writeFileSync(backend, "tampered");
          assert.equal(tsx("script/verify-release.ts", `release/${prefix}-server`).status, 1);
          cpSync("dist/index.cjs", backend);
        },
      );
      await t.test(
        "compiled app and migrations run without source or development dependencies",
        async () => {
          cpSync(`release/${prefix}-full/payload`, sandbox, { recursive: true });
          cpSync(`release/${prefix}-runtime/payload`, sandbox, { recursive: true });
          const npm = spawnSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
            cwd: sandbox,
            encoding: "utf8",
            env: process.env,
          });
          assert.equal(npm.status, 0, npm.stdout + npm.stderr);
          assert.equal(existsSync(path.join(sandbox, "node_modules/vite")), false);
          assert.equal(existsSync(path.join(sandbox, "node_modules/tsx")), false);
          assert.equal(existsSync(path.join(sandbox, "node_modules/express")), false);
          assert.equal(existsSync(path.join(sandbox, "server")), false);
          const runtimeCheck = spawnSync("npm", ["run", "runtime:check"], {
            cwd: sandbox,
            encoding: "utf8",
          });
          assert.equal(runtimeCheck.status, 0, runtimeCheck.stdout + runtimeCheck.stderr);
          const env = {
            ...process.env,
            NODE_ENV: "production",
            DB_PATH: path.join(sandbox, "data/club.sqlite"),
            SETUP_PATH: path.join(sandbox, "private/setup.txt"),
          };
          const migrate = (...args: string[]) =>
            spawnSync(process.execPath, ["dist/migrate.cjs", ...args], {
              cwd: sandbox,
              env,
              encoding: "utf8",
            });
          const missing = spawnSync(process.execPath, ["dist/index.cjs"], {
            cwd: sandbox,
            env,
            encoding: "utf8",
          });
          assert.equal(missing.status, 1);
          assert.match(missing.stderr, /explicit migration/);
          assert.equal(existsSync(env.DB_PATH), false);
          assert.equal(migrate("--status").status, 2);
          const initialized = migrate("--apply", "--init");
          assert.equal(initialized.status, 0, initialized.stderr);
          assert.equal(existsSync(env.SETUP_PATH), false);
          assert.equal(migrate("--status").status, 0);
          // Reserve an available test port, never use the preview/live service port.
          const reservation = createServer();
          reservation.listen(0, "127.0.0.1");
          await once(reservation, "listening");
          const port = (reservation.address() as { port: number }).port;
          await new Promise<void>((resolve) => reservation.close(() => resolve()));
          let output = "";
          server = spawn(process.execPath, ["dist/index.cjs"], {
            cwd: sandbox,
            env: { ...env, PORT: String(port) },
          });
          server.stdout?.on("data", (chunk) => {
            output += chunk;
          });
          server.stderr?.on("data", (chunk) => {
            output += chunk;
          });
          const base = `http://127.0.0.1:${port}`;
          let ready = false;
          for (let i = 0; i < 100; i++) {
            if (server.exitCode !== null) break;
            try {
              ready = (await fetch(`${base}/api/auth/status`)).ok;
              if (ready) break;
            } catch {}
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          assert.equal(ready, true, output);
          assert.equal((await fetch(`${base}/`)).status, 200);
          assert.deepEqual(await (await fetch(`${base}/api/auth/status`)).json(), {
            setupRequired: true,
          });
          assert.equal((await fetch(`${base}/api/member/hub`)).status, 401);
          assert.equal((await fetch(`${base}/private/setup.txt`)).status, 404);
          const setup = await fetch(`${base}/api/auth/setup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: readFileSync(env.SETUP_PATH, "utf8").trim(),
              name: "Release QA",
              email: "release@example.test",
              password: "qa-only-long-password-12345",
            }),
          });
          assert.equal(setup.status, 201, "owner setup succeeds in the isolated runtime");
          const auth = (await setup.json()) as { token: string };
          assert.equal(
            (
              await fetch(`${base}/api/member/hub`, {
                headers: { Authorization: `Bearer ${auth.token}` },
              })
            ).status,
            200,
          );
          const exit = once(server, "exit");
          server.kill("SIGTERM");
          await exit;
          server = undefined;
          assert.equal(migrate("--apply", "--backup-confirmed").status, 0);
        },
      );
    } finally {
      if (server && server.exitCode === null) {
        const exited = once(server, "exit");
        server.kill("SIGTERM");
        await exited;
      }
      for (const file of generated) {
        if (previous.has(file)) {
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, previous.get(file)!);
        } else rmSync(file, { force: true });
      }
      for (const directory of releases) rmSync(directory, { recursive: true, force: true });
      rmSync(sandbox, { recursive: true, force: true });
    }
  },
);
