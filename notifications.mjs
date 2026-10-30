import { randomBytes } from "node:crypto";
import path from "node:path";
import { transaction, wildcardType } from "./db.mjs";

export const MAIL_FROM = { name: "CABC Calendar", address: "calendar@cabc.club" };
export function notificationsAvailable(db) {
  return db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('notification_preferences','notification_outbox')").get().n === 2;
}
export function preference(db, memberId) {
  db.prepare("INSERT INTO notification_preferences(member_id,token,updated_at) VALUES(?,?,?) ON CONFLICT(member_id) DO NOTHING")
    .run(memberId, randomBytes(32).toString("hex"), new Date().toISOString());
  return db.prepare("SELECT * FROM notification_preferences WHERE member_id=?").get(memberId);
}
export function setPreference(db, memberId, enabled) {
  preference(db, memberId);
  // Re-enabling invalidates links from earlier emails; scanners never opt out via GET.
  db.prepare("UPDATE notification_preferences SET enabled=?,token=CASE WHEN ?=1 THEN ? ELSE token END,updated_at=? WHERE member_id=?")
    .run(enabled ? 1 : 0, enabled ? 1 : 0, randomBytes(32).toString("hex"), new Date().toISOString(), memberId);
}
export function entrySnapshot(db, gameId) {
  return db.prepare("SELECT member_id,partner_id FROM entries WHERE game_id=? ORDER BY member_id").all(gameId);
}
export function queueChanges(db, { game, before, after, actor, cancelledGame = false, now = Date.now() }) {
  if (!notificationsAvailable(db)) return;
  const previous = new Map(before.map(e => [e.member_id, e]));
  const current = new Map(after.map(e => [e.member_id, e]));
  const event = randomBytes(16).toString("hex");
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const old = previous.get(id), next = current.get(id);
    if (!cancelledGame && !!old === !!next && old?.partner_id === next?.partner_id) continue;
    const member = db.prepare("SELECT id,name,email,active FROM members WHERE id=?").get(id);
    if (!member || member.active !== 1 || wildcardType(member.name)) continue;
    if (!preference(db, id).enabled) continue;
    const partner = next?.partner_id
      ? db.prepare("SELECT name FROM members WHERE id=?").get(next.partner_id)?.name || null : null;
    const kind = cancelledGame ? "game-cancelled" : !next ? "cancelled" : old?.partner_id && !next.partner_id ? "partner-cancelled" : "registered";
    const payload = { kind, memberName: member.name, game: { id: game.id, date: game.date, time: game.time, name: game.name },
      partner, actorName: actor.name, delegated: actor.id !== id };
    db.prepare("INSERT INTO notification_outbox(id,event_id,member_id,email,payload_json,created_at,next_attempt) VALUES(?,?,?,?,?,?,?)")
      .run(randomBytes(16).toString("hex"), event, id, member.email, JSON.stringify(payload), now, now);
  }
}
export function mailConfiguration(env = process.env) {
  if (env.EMAIL_ENABLED !== "1") throw new Error("Email delivery is disabled. Set EMAIL_ENABLED=1 only after reviewing EMAIL-NOTIFICATIONS.md.");
  if (!env.DB_PATH || !path.isAbsolute(env.DB_PATH)) throw new Error("Set the existing private database's absolute DB_PATH for the mail worker.");
  const host = env.SMTP_HOST || "mail.cabc.club", port = Number(env.SMTP_PORT || 465);
  const user = env.SMTP_USER || MAIL_FROM.address, pass = env.SMTP_PASSWORD;
  if (host !== "mail.cabc.club" || port !== 465)
    throw new Error("This release requires mail.cabc.club:465 with implicit TLS.");
  if (user !== MAIL_FROM.address || !pass || /[\r\n]/.test(pass))
    throw new Error("Set SMTP_USER=calendar@cabc.club and a private SMTP_PASSWORD.");
  const site = new URL(env.CABC_SITE_URL || "https://cabc.club");
  if (site.protocol !== "https:" || site.username || site.password || site.search || site.hash)
    throw new Error("CABC_SITE_URL must be an HTTPS site URL without credentials, query or fragment.");
  const batch = Number(env.MAIL_BATCH_SIZE || 5);
  if (!Number.isInteger(batch) || batch < 1 || batch > 20) throw new Error("MAIL_BATCH_SIZE must be 1 to 20.");
  return { host, port, secure: true, auth: { user, pass }, site: site.href.replace(/\/$/, ""), batch };
}
export function renderMail(payload, token, site = "https://cabc.club") {
  const { kind, game, partner } = payload;
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${game.date}T12:00:00Z`));
  const [hour, minute] = game.time.split(":").map(Number);
  const time = `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"} Pacific`;
  const title = game.name || "Club game";
  const marker = partner && wildcardType(partner);
  const status = marker === "unavailable" ? "Your status is Unavailable; you are not registered to play."
    : marker === "standby" ? "Your status is Standby."
    : marker === "guest" ? "You are registered with a guest."
    : partner ? `You are registered with ${partner}.` : "You are registered and looking for a partner.";
  const summary = kind === "game-cancelled" ? "The entire game has been cancelled. Your registration for this game has been removed."
    : kind === "cancelled" ? "Your registration for this game has been cancelled."
    : kind === "partner-cancelled" ? "Your partner's registration has been cancelled. You remain registered and are now looking for a partner."
    : status;
  const heading = kind === "game-cancelled" ? "Game cancelled" : kind === "cancelled" ? "Registration cancelled"
    : kind === "partner-cancelled" ? "Partner cancellation" : marker === "unavailable" || marker === "standby" ? "Availability updated" : "Registration confirmed";
  return {
    from: MAIL_FROM,
    subject: `${heading}: ${title} (${game.date})`.replace(/[\r\n]/g, " ").slice(0, 240),
    text: `Hello ${payload.memberName},\n\n${summary}\n\n${title}\n${date}\n${time}\n${payload.delegated ? `\nChanged by ${payload.actorName}.\n` : ""}\nOpen the calendar: ${site}/#calendar\n\nEmail notifications are on by default. To stop registration and cancellation emails, open this link and confirm:\n${site}/#email-opt-out/${token}\n\nYou can turn emails back on in Email notifications while signed in. This does not change your game registrations.\n\nChinese American Bridge Club\n`
  };
}
// Only generic codes are persisted/logged, never SMTP credentials or server replies.
function failure(error, phase) {
  if (error.code === "EAUTH" || error.code === "ETLS" || (error.responseCode >= 500 && error.responseCode < 600))
    return { state: "failed", reason: "SMTP rejected delivery, authentication or TLS verification." };
  if (phase === "verify" || (error.responseCode >= 400 && error.responseCode < 500))
    return { state: "pending", reason: "Temporary SMTP connection failure or explicit temporary rejection." };
  // Nodemailer can report CONN even after DATA was transmitted. Never assume a
  // disconnected send is safe to repeat merely from its error.command.
  return { state: "uncertain", reason: "Delivery outcome uncertain; review before retrying (duplicate risk)." };
}
export async function processQueue(db, { transport, batch = 5, site = "https://cabc.club", now = () => Date.now() }) {
  if (db.prepare("SELECT value FROM metadata WHERE key='preview'").get()?.value === "1")
    throw new Error("Email delivery is forbidden for a preview database.");
  if (!notificationsAvailable(db)) throw new Error("Run node migrate.mjs notifications first.");
  const owner = randomBytes(16).toString("hex"), lease = 10 * 60 * 1000;
  const acquired = transaction(db, () => {
    const old = db.prepare("SELECT value FROM metadata WHERE key='email-worker-lock'").get();
    if (old && JSON.parse(old.value).until > now()) return false;
    db.prepare("INSERT INTO metadata(key,value) VALUES('email-worker-lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify({ owner, until: now() + lease }));
    db.prepare("UPDATE notification_outbox SET state='uncertain',last_error='Worker interrupted; review before retrying (duplicate risk).' WHERE state='sending' AND locked_until<?").run(now());
    return true;
  });
  if (!acquired) return { busy: true, processed: 0 };
  let processed = 0;
  try {
    while (processed < batch) {
      const row = transaction(db, () => {
        const lock = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='email-worker-lock'").get().value);
        if (lock.owner !== owner) return null;
        db.prepare("UPDATE metadata SET value=? WHERE key='email-worker-lock'").run(JSON.stringify({ owner, until: now() + lease }));
        const item = db.prepare("SELECT * FROM notification_outbox WHERE state='pending' AND next_attempt<=? ORDER BY created_at,rowid LIMIT 1").get(now());
        if (!item) return null;
        db.prepare("UPDATE notification_outbox SET state='sending',attempts=attempts+1,locked_until=? WHERE id=?").run(now() + lease, item.id);
        return item;
      });
      if (!row) break;
      processed++;
      const member = db.prepare("SELECT name,email,active FROM members WHERE id=?").get(row.member_id);
      const pref = preference(db, row.member_id);
      const payload = JSON.parse(row.payload_json);
      const currentGame = db.prepare("SELECT date,time,name FROM games WHERE id=?").get(payload.game.id);
      const currentEntry = db.prepare("SELECT e.partner_id,m.name AS partner FROM entries e LEFT JOIN members m ON m.id=e.partner_id WHERE e.game_id=? AND e.member_id=?")
        .get(payload.game.id, row.member_id);
      // Never deliver an old registration after a cancellation, re-pairing or
      // schedule change while an earlier SMTP attempt was backing off.
      const matchingGame = currentGame && ["date", "time", "name"].every(key => currentGame[key] === payload.game[key]);
      const superseded = payload.kind === "registered" ? !matchingGame || !currentEntry || (currentEntry.partner || null) !== payload.partner
        : payload.kind === "partner-cancelled" ? !matchingGame || !currentEntry || currentEntry.partner_id !== null
        : payload.kind === "cancelled" ? !!currentEntry : false;
      if (!member || member.active !== 1 || wildcardType(member.name) || !pref.enabled || member.email !== row.email ||
          superseded ||
          now() - row.created_at > 48 * 3600000 || payload.game.date < new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit"
          }).format(new Date(now()))) {
        db.prepare("UPDATE notification_outbox SET state='skipped',locked_until=NULL,last_error='Opted out, inactive, changed address, expired or superseded notification.' WHERE id=?").run(row.id);
        continue;
      }
      let phase = "verify";
      try {
        const message = { ...renderMail(payload, pref.token, site), to: row.email, messageId: `<${row.id}@cabc.club>` };
        await transport.verify?.(); // Authentication/TLS only; does not send a message.
        phase = "send";
        await transport.sendMail(message);
        db.prepare("UPDATE notification_outbox SET state='sent',locked_until=NULL,last_error=NULL WHERE id=?").run(row.id);
      } catch (error) {
        const problem = failure(error, phase), attempts = row.attempts + 1;
        const state = problem.state === "pending" && attempts >= 5 ? "failed" : problem.state;
        db.prepare("UPDATE notification_outbox SET state=?,locked_until=NULL,last_error=?,next_attempt=? WHERE id=?")
          .run(state, problem.reason, now() + Math.min(3600000, 60000 * 2 ** attempts), row.id);
      }
    }
    return { busy: false, processed };
  } finally {
    transaction(db, () => {
      const lock = db.prepare("SELECT value FROM metadata WHERE key='email-worker-lock'").get();
      if (lock && JSON.parse(lock.value).owner === owner) db.prepare("DELETE FROM metadata WHERE key='email-worker-lock'").run();
    });
  }
}
