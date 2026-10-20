import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { openDatabase, addMember, transaction, passwordHash, clubToday } from "./db.mjs";

process.umask(0o077);
const command = process.argv[2];
if (!["init", "preview", "reset-password"].includes(command)) {
  console.error("Usage: node manage.mjs init | preview | reset-password");
  process.exit(1);
}
const db = openDatabase(undefined, command !== "reset-password");
try {
  if (command === "preview") {
    if (db.prepare("SELECT count(*) AS n FROM members").get().n) throw new Error("Preview seeding requires an empty database. No records were changed.");
    transaction(db, () => {
      db.prepare("INSERT INTO metadata VALUES('preview','1')").run();
      const users = [
        ["Alex Chen", "member@preview.invalid", "member"], ["Morgan Lee", "admin@preview.invalid", "admin"],
        ["Jamie Wu", "jamie@preview.invalid", "member"], ["Robin Lin", "robin@preview.invalid", "member"],
        ["Casey Wong", "casey@preview.invalid", "member"], ["Taylor Park", "taylor@preview.invalid", "member"],
        ["Sam Liu", "sam@preview.invalid", "member"], ["Jordan Chan", "jordan@preview.invalid", "member"]
      ];
      for (const [name, email, role] of users) addMember(db, { name, email, password: randomBytes(24).toString("hex") }, role);
      const today = process.env.PREVIEW_TODAY || clubToday();
      const start = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
      for (let i = 0; i < 62; i++) {
        const day = new Date(start.valueOf() + i * 86400000);
        if (day.getUTCDay() !== 1) continue;
        const result = db.prepare("INSERT INTO games(date,time) VALUES(?,'11:30')").run(day.toISOString().slice(0, 10));
        const game = Number(result.lastInsertRowid);
        const put = db.prepare("INSERT INTO entries VALUES(?,?,?)");
        put.run(game, 3, 4); put.run(game, 4, 3);
        if (i % 2) { put.run(game, 5, 6); put.run(game, 6, 5); }
        put.run(game, 7, null);
      }
    });
    console.log("Fictional preview data created. Preview access requires PREVIEW_MODE=1 and must never be used for real member data.");
  } else {
    if (!stdin.isTTY) throw new Error("Use an interactive terminal to create or reset credentials.");
    const readline = createInterface({ input: stdin, output: stdout });
    try {
      const email = (await readline.question("Email: ")).trim().toLowerCase();
      const name = command === "init" ? (await readline.question("Name: ")).trim() : "";
      const password = randomBytes(18).toString("base64url");
      if (command === "init") {
        if (db.prepare("SELECT count(*) AS n FROM members").get().n) throw new Error("An administrator already exists. Initialization will not replace accounts.");
        addMember(db, { name, email, password }, "admin");
      } else {
        const member = db.prepare("SELECT id FROM members WHERE email=?").get(email);
        if (!member) throw new Error("Account not found.");
        transaction(db, () => {
          db.prepare("UPDATE members SET password=? WHERE id=?").run(passwordHash(password), member.id);
          db.prepare("DELETE FROM sessions WHERE member_id=?").run(member.id);
        });
      }
      console.log(`Generated password (store securely; it will not be shown again): ${password}`);
    } finally { readline.close(); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db.close(); }
