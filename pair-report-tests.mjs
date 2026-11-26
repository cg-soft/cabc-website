import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openDatabase, addMember } from "./db.mjs";
import { upcomingPairs, describePairs, describePlayed } from "./pair-report.mjs";

test("pair report counts real and guest pairs on upcoming dates only", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "cabc-pairs-"));
  const filename = path.join(directory, "club.sqlite");
  const db = openDatabase(filename, true);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const m = name => addMember(db, { name, email: `${name.replace(/\W/g, "")}@example.test`, password: "Pair-report-fixture-2026" });
  const [a, b, c, d] = ["Ann", "Bob", "Cy", "Di"].map(m);
  const guest = m("-Guest-"), standby = m("-Standby-"), director = m("-Director-");
  const game = db.prepare("INSERT INTO games(id,date) VALUES(?,?)");
  game.run(1, "2000-01-03"); game.run(2, "2099-01-04"); game.run(3, "2099-01-11"); game.run(4, "2099-01-18");
  const put = db.prepare("INSERT INTO entries VALUES(?,?,?)");
  put.run(1, a, b); put.run(1, b, a);                      // past: ignored
  for (const g of [2, 3]) { put.run(g, a, b); put.run(g, b, a); }
  put.run(2, c, guest); put.run(2, d, standby); put.run(2, director, null);
  put.run(3, c, null);
  put.run(4, a, b); put.run(4, b, a); put.run(4, c, d); put.run(4, d, c);
  const result = upcomingPairs(db, "2099-01-01");
  assert.deepEqual(result.report.map(g => [g.date, g.pairs.map(p => p.label), g.alone]),
    [["2099-01-04", ["Ann & Bob", "Cy & -Guest-"], []], ["2099-01-11", ["Ann & Bob"], ["Cy"]], ["2099-01-18", ["Ann & Bob", "Cy & Di"], []]]);
  assert.deepEqual(result.totals.map(t => [t.count, t.label]), [[3, "Ann & Bob"], [1, "Cy & -Guest-"], [1, "Cy & Di"]]);
  assert.match(describePairs(result), /  3  Ann & Bob/);
  const run = (...args) => spawnSync(process.execPath, ["manage.mjs", "pair-report", ...args], { env: { ...process.env, DB_PATH: filename }, encoding: "utf8" });
  const cli = run();
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /2099-01-04 11:30 - 2 pairs/);
  assert.doesNotMatch(cli.stdout, /2000-01-03/);
  assert.notEqual(run("x").status, 0);
  const all = upcomingPairs(db, "2099-01-01", true);
  assert.deepEqual(all.totals.map(t => [t.label, t.played, t.upcoming, t.last]),
    [["Ann & Bob", 1, 3, "2000-01-03"], ["Cy & -Guest-", 0, 1, null], ["Cy & Di", 0, 1, null]]);
  assert.match(describePlayed(all, "2099-01-01"), /4 games: 1 past, 3 upcoming/);
  const played = run("--played");
  assert.equal(played.status, 0, played.stderr);
  assert.match(played.stdout, /Ann & Bob/);
  assert.match(played.stdout, /2000-01-03/);
  assert.equal(db.prepare("SELECT count(*) n FROM entries").get().n, 14);
});
