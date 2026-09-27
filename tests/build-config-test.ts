import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanBuildOutput } from "../script/clean-build";

test("cleanup preserves .htaccess content, inode and permissions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cabc-build-"));
  try {
    await mkdir(path.join(dir, "public"));
    await writeFile(path.join(dir, ".htaccess"), "parent", { mode: 0o600 });
    await writeFile(path.join(dir, "public/.htaccess"), "host config", { mode: 0o640 });
    await writeFile(path.join(dir, "public/old.js"), "stale");
    const before = await stat(path.join(dir, "public/.htaccess"));
    await cleanBuildOutput(dir);
    const after = await stat(path.join(dir, "public/.htaccess"));
    assert.equal(before.ino, after.ino);
    assert.equal(before.mode, after.mode);
    assert.equal(await readFile(path.join(dir, "public/.htaccess"), "utf8"), "host config");
    assert.equal(await readFile(path.join(dir, ".htaccess"), "utf8"), "parent");
    await assert.rejects(stat(path.join(dir, "public/old.js")), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanup accepts missing paths and does not follow nested symlinks", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cabc-build-"));
  try {
    await cleanBuildOutput(path.join(dir, "missing"));
    await mkdir(path.join(dir, "output"));
    await mkdir(path.join(dir, "other"));
    await writeFile(path.join(dir, "other/keep"), "safe");
    await symlink(path.join(dir, "other"), path.join(dir, "output/public"));
    await assert.rejects(cleanBuildOutput(path.join(dir, "output/public")), /symlinked/);
    await cleanBuildOutput(path.join(dir, "output"));
    assert.equal(await readFile(path.join(dir, "other/keep"), "utf8"), "safe");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
