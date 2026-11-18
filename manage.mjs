import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import path from "node:path";
import { openDatabase, addMember, transaction, passwordHash, clubToday, requireMemberStatus, wildcardType } from "./db.mjs";
import { reviewMemberMerge, applyMemberMerge, describeMemberMerge } from "./merge-member.mjs";

process.umask(0o077);
const command = process.argv[2];
const dryRun = command === "merge-member" && process.argv[3] === "--dry-run";
if (!["init", "preview", "reset-password", "promote", "demote", "merge-member"].includes(command) ||
    (command === "merge-member" && process.argv.length !== (dryRun ? 4 : 3))) {
  console.error("Usage: node manage.mjs init | preview | reset-password | promote | demote | merge-member [--dry-run]");
  process.exit(1);
}
let db;
try {
  if (command === "merge-member") {
    if (!stdin.isTTY) throw new Error("Use an interactive terminal to merge member accounts.");
    if (!process.env.DB_PATH || !path.isAbsolute(process.env.DB_PATH))
      throw new Error("Set DB_PATH to the absolute path of the existing database or a test copy.");
  }
  db = openDatabase(undefined, ["init", "preview"].includes(command));
  if (command === "demote") requireMemberStatus(db);
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
    if (!stdin.isTTY) throw new Error("Use an interactive terminal to manage accounts.");
    const readline = createInterface({ input: stdin, output: stdout });
    try {
      const email = (await readline.question(command === "merge-member" ? "Email to keep: " : "Email: ")).trim().toLowerCase();
      if (command === "merge-member") {
        const duplicate = (await readline.question("Duplicate email to retire: ")).trim().toLowerCase();
        const plan = reviewMemberMerge(db, email, duplicate);
        console.log(describeMemberMerge(plan));
        if (dryRun) console.log("Dry run. No member records were changed.");
        else {
          const confirmation = await readline.question("Type MERGE to apply these changes: ");
          if (confirmation.trim() !== "MERGE") throw new Error("Merge cancelled. No member records were changed.");
          applyMemberMerge(db, plan);
          console.log("Merge complete. The duplicate was deactivated and signed out; no notifications were generated.");
        }
      } else if (command === "demote") {
        const selected = db.prepare("SELECT id,name,email,role,active FROM members WHERE email=?").get(email);
        if (!selected) throw new Error("Account not found. No accounts were changed.");
        if (wildcardType(selected.name)) throw new Error("Choose a real member, not a placeholder account.");
        if (selected.role !== "admin") {
          console.log(`${selected.name} (${selected.email}) is already a regular member. No changes made.`);
        } else {
          console.log(`Selected administrator: ${selected.name} (${selected.email})${selected.active === 0 ? " [inactive]" : ""}`);
          const confirmation = await readline.question("Type DEMOTE to remove administrator access and sign out this account on all devices: ");
          if (confirmation.trim() !== "DEMOTE") throw new Error("Demotion cancelled. No accounts were changed.");
          const message = transaction(db, () => {
            const current = db.prepare("SELECT id,name,email,role,active FROM members WHERE id=?").get(selected.id);
            if (!current || Object.keys(selected).some(key => current[key] !== selected[key]))
              throw new Error("This account changed. Run demote again and review the account. No accounts were changed.");
            const remainingAdmins = db.prepare("SELECT name FROM members WHERE active=1 AND role='admin' AND id<>?")
              .all(current.id).filter(member => !wildcardType(member.name));
            if (current.active === 1 && remainingAdmins.length === 0)
              throw new Error("You cannot remove the last active administrator. No accounts were changed.");
            db.prepare("UPDATE members SET role='member' WHERE id=?").run(current.id);
            db.prepare("DELETE FROM sessions WHERE member_id=?").run(current.id);
            return `Administrator access removed from ${current.name} (${current.email}). Account, password and scheduled games unchanged. Signed out on all devices.`;
          });
          console.log(message);
        }
      } else if (command === "promote") {
        const message = transaction(db, () => {
          const member = db.prepare("SELECT * FROM members WHERE email=?").get(email);
          if (!member) throw new Error("Account not found. No accounts were changed.");
          if (member.active === 0) throw new Error("Account is inactive. Promotion will not reactivate it.");
          if (member.role === "admin") return `${member.name} (${member.email}) is already an administrator. No changes made.`;
          db.prepare("UPDATE members SET role='admin' WHERE id=?").run(member.id);
          return `Administrator access granted to ${member.name} (${member.email}). Ask them to log out and log back in.`;
        });
        console.log(message);
      } else {
        const name = command === "init" ? (await readline.question("Name: ")).trim() : "";
        const password = randomBytes(18).toString("base64url");
        if (command === "init") {
          if (db.prepare("SELECT count(*) AS n FROM members").get().n) throw new Error("An administrator already exists. Initialization will not replace accounts.");
          addMember(db, { name, email, password }, "admin");
        } else {
          const member = db.prepare("SELECT * FROM members WHERE email=?").get(email);
          if (!member) throw new Error("Account not found.");
          transaction(db, () => {
            if (db.prepare("SELECT * FROM members WHERE id=?").get(member.id)?.active === 0)
              throw new Error("Account is inactive. Password reset will not reactivate it.");
            db.prepare("UPDATE members SET password=? WHERE id=?").run(passwordHash(password), member.id);
            db.prepare("DELETE FROM sessions WHERE member_id=?").run(member.id);
          });
        }
        console.log(`Generated password (store securely; it will not be shown again): ${password}`);
      }
    } finally { readline.close(); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db?.close(); }
