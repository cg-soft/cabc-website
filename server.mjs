import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { registeredGamesCalendar } from "./icalendar.mjs";
import { ROOT, openDatabase, passwordHash, passwordMatches, hashToken, transaction, addMember, clubToday, HttpError } from "./db.mjs";

export function createApp({ db = openDatabase(), preview = false, previewToday } = {}) {
  if (!db.prepare("PRAGMA table_info(games)").all().some(column => column.name === "event_type") ||
      !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_members'").get() ||
      db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('dissolve_team_before_entry_delete','dissolve_team_before_partner_change')").get().n !== 2)
    throw new Error("Team-events migration required. Run node migrate.mjs team-events with the same DB_PATH. Startup never migrates databases.");
  if (preview && db.prepare("SELECT value FROM metadata WHERE key='preview'").get()?.value !== "1")
    throw new Error("Preview access is restricted to an explicitly seeded preview database.");
  const today = () => preview && previewToday ? previewToday : clubToday();
  const dummy = passwordHash(randomBytes(32).toString("hex"));
  const attempts = new Map();
  const passwordAttempts = new Map();
  function passwordLimit(memberId) {
    const now = Date.now();
    if (passwordAttempts.size > 1000)
      for (const [id, value] of passwordAttempts) if (value.until <= now) passwordAttempts.delete(id);
    let value = passwordAttempts.get(memberId);
    if (!value || value.until <= now) {
      value = { count: 0, until: now + 15 * 60000 };
      passwordAttempts.set(memberId, value);
    }
    if (++value.count > 5)
      throw new HttpError(429, "Too many password-change attempts. Please wait 15 minutes.");
  }
  function limit(req) {
    const key = req.socket.remoteAddress;
    const now = Date.now();
    if (attempts.size > 1000) for (const [ip, state] of attempts) if (state.until < now) attempts.delete(ip);
    let state = attempts.get(key);
    if (!state || state.until < now) { state = { count: 0, until: now + 900000 }; attempts.set(key, state); }
    if (++state.count > 30) throw new HttpError(429, "Too many sign-in attempts. Please wait 15 minutes.");
  }
  function session(member) {
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hashToken(token), member.id, Date.now() + 12 * 3600000);
    return { token, member: { id: member.id, name: member.name, role: member.role } };
  }
  function auth(req) {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, "Please sign in again.");
    const user = db.prepare("SELECT m.id,m.name,m.role FROM members m JOIN sessions s ON s.member_id=m.id WHERE s.hash=? AND s.expires>?")
      .get(hashToken(token), Date.now());
    if (!user) throw new HttpError(401, "Your session has expired. Please sign in again.");
    return user;
  }
  function admin(user) { if (user.role !== "admin") throw new HttpError(403, "Administrator access required."); }
  function gameName(value = "") {
    if (typeof value !== "string" || value.trim().length > 80)
      throw new HttpError(400, "Game name must be text of at most 80 characters.");
    return value.trim();
  }
  function game(id) {
    const row = db.prepare("SELECT * FROM games WHERE id=?").get(id);
    if (!row) throw new HttpError(404, "Playing date not found.");
    if (row.date < today()) throw new HttpError(409, "Registration for this date is closed.");
    return row;
  }
  function completePair(gameId, memberId) {
    const partner = db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(gameId, memberId)?.partner_id;
    if (!partner || db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(gameId, partner)?.partner_id !== memberId)
      throw new HttpError(409, "Both pairs must be fully registered. Refresh the calendar and try again.");
    return [memberId, partner];
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(req.url, "http://localhost");
      const route = url.pathname;
      if (!route.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
        const files = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/style.css": "style.css", "/config.js": "config.js",
          "/slides/table.webp": "slides/table.webp", "/slides/room.webp": "slides/room.webp", "/favicon.png": "favicon.png", "/club-logo.png": "club-logo.png" };
        const file = files[route];
        if (!file) throw new HttpError(404, "Not found.");
        const content = await readFile(path.join(ROOT, "public", file));
        const mime = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".png") ? "image/png" : "image/webp";
        res.writeHead(200, { "Content-Type": mime.startsWith("image/") ? mime : `${mime}; charset=utf-8`, "Cache-Control": "no-cache" });
        res.end(req.method === "HEAD" ? undefined : content);
        return;
      }
      let body = {};
      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        if (!req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "JSON required.");
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) throw new HttpError(413, "Request too large.");
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
        catch { throw new HttpError(400, "Invalid request."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request.");
      }
      if (route === "/api/config" && req.method === "GET") return reply(200, { preview, today: today() });
      if (route === "/api/login" && req.method === "POST") {
        limit(req);
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (password.length > 128 || email.length > 180) throw new HttpError(400, "Invalid email or password.");
        const member = db.prepare("SELECT * FROM members WHERE email=?").get(email);
        const valid = passwordMatches(password, member?.password || dummy);
        if (!member || !valid) throw new HttpError(401, "Email or password is incorrect.");
        return reply(200, session(member));
      }
      if (route === "/api/preview" && req.method === "POST") {
        if (!preview) throw new HttpError(404, "Not found.");
        limit(req);
        const email = body.role === "admin" ? "admin@preview.invalid" : "member@preview.invalid";
        return reply(200, session(db.prepare("SELECT * FROM members WHERE email=?").get(email)));
      }
      const user = auth(req);
      if (route === "/api/calendar/export.ics" && req.method === "GET") {
        const games = db.prepare("SELECT g.id,g.date,g.time,g.name FROM games g JOIN entries e ON e.game_id=g.id WHERE e.member_id=? AND g.date>=? ORDER BY g.date,g.time,g.id")
          .all(user.id, today());
        if (!games.length) throw new HttpError(404, "You have no registered games for today or later to export.");
        const content = registeredGamesCalendar(games);
        res.writeHead(200, {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="cabc-my-games.ics"',
          "Cache-Control": "private, no-store"
        });
        res.end(content);
        return;
      }
      if (route === "/api/password" && req.method === "POST") {
        const { currentPassword, newPassword, confirmPassword } = body;
        if (typeof currentPassword !== "string" || currentPassword.length < 1 || currentPassword.length > 128)
          throw new HttpError(400, "Enter your current password.");
        if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128)
          throw new HttpError(400, "Use a new password of 12 to 128 characters.");
        if (typeof confirmPassword !== "string" || confirmPassword !== newPassword)
          throw new HttpError(400, "The new passwords do not match.");
        if (newPassword === currentPassword)
          throw new HttpError(400, "Choose a new password different from your current password.");
        passwordLimit(user.id);
        const member = db.prepare("SELECT password FROM members WHERE id=?").get(user.id);
        if (!member || !passwordMatches(currentPassword, member.password))
          throw new HttpError(400, "Your current password is incorrect.");
        const replacement = passwordHash(newPassword);
        transaction(db, () => {
          // Recheck the session and old hash under the write lock: another process
          // may have reset the password while this request was being verified.
          auth(req);
          const changed = db.prepare("UPDATE members SET password=? WHERE id=? AND password=?")
            .run(replacement, user.id, member.password);
          if (changed.changes !== 1)
            throw new HttpError(409, "Your account changed. Please sign in again before retrying.");
          db.prepare("DELETE FROM sessions WHERE member_id=?").run(user.id);
        });
        passwordAttempts.delete(user.id);
        return reply(200, { ok: true });
      }
      if (route === "/api/logout" && req.method === "POST") {
        db.prepare("DELETE FROM sessions WHERE hash=?").run(hashToken(req.headers.authorization.slice(7)));
        return reply(200, { ok: true });
      }
      if (route === "/api/calendar" && req.method === "GET") {
        const requested = url.searchParams.get("month");
        if (requested !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)) throw new HttpError(400, "Choose a valid month.");
        const currentDate = today();
        const months = db.prepare("SELECT DISTINCT substr(date,1,7) AS month FROM games WHERE date>=? ORDER BY month")
          .all(currentDate).map(row => row.month);
        const month = months.includes(requested) ? requested : (months[0] || null);
        const games = month ? db.prepare("SELECT * FROM games WHERE date LIKE ? ORDER BY date").all(`${month}-%`) : [];
        const entries = month ? db.prepare("SELECT e.game_id,e.member_id,e.partner_id,m.name FROM entries e JOIN members m ON m.id=e.member_id JOIN games g ON g.id=e.game_id WHERE g.date LIKE ? ORDER BY m.name")
          .all(`${month}-%`) : [];
        // Only names and IDs needed for partnership selection, never member emails.
        const members = db.prepare("SELECT id,name FROM members ORDER BY name").all();
        const teamRows = month ? db.prepare("SELECT t.game_id,t.team_id,t.member_id FROM team_members t JOIN games g ON g.id=t.game_id WHERE g.date LIKE ? ORDER BY t.team_id,t.member_id").all(`${month}-%`) : [];
        const groups = new Map();
        for (const row of teamRows) {
          const key = `${row.game_id}:${row.team_id}`;
          if (!groups.has(key)) groups.set(key, { id: row.team_id, game_id: row.game_id, memberIds: [] });
          groups.get(key).memberIds.push(row.member_id);
        }
        return reply(200, { month, months, games, entries, members, teams: [...groups.values()], user, today: currentDate });
      }
      const teamRoute = /^\/api\/games\/(\d+)\/team$/.exec(route);
      if (teamRoute && ["POST", "DELETE"].includes(req.method)) {
        const gameId = Number(teamRoute[1]);
        transaction(db, () => {
          auth(req);
          if (game(gameId).event_type !== "teams") throw new HttpError(409, "This date is a pairs event, not a team event.");
          if (req.method === "DELETE") {
            if (typeof body.teamId !== "string") throw new HttpError(400, "Choose your current team.");
            const current = db.prepare("SELECT team_id FROM team_members WHERE game_id=? AND member_id=?").get(gameId, user.id);
            if (!current || current.team_id !== body.teamId)
              throw new HttpError(409, "Your team changed. Refresh the calendar and try again.");
            db.prepare("DELETE FROM team_members WHERE game_id=? AND team_id=?").run(gameId, current.team_id);
          } else {
            const { pairMemberId, pairPartnerId, ownPartnerId } = body;
            if (![pairMemberId, pairPartnerId, ownPartnerId].every(id => Number.isSafeInteger(id) && id > 0))
              throw new HttpError(400, "Choose an available registered pair.");
            const own = completePair(gameId, user.id);
            const other = completePair(gameId, pairMemberId);
            if (own[1] !== ownPartnerId || other[1] !== pairPartnerId)
              throw new HttpError(409, "A partnership changed. Refresh the calendar and choose again.");
            const ids = [...own, ...other];
            if (new Set(ids).size !== 4) throw new HttpError(400, "Choose a different pair to form a four-person team.");
            const occupied = db.prepare("SELECT member_id FROM team_members WHERE game_id=? AND member_id IN (?,?,?,?)").all(gameId, ...ids);
            if (occupied.length) throw new HttpError(409, "One of these pairs is already on a team. Refresh the calendar and choose again.");
            const teamId = randomBytes(16).toString("hex");
            const insert = db.prepare("INSERT INTO team_members(game_id,member_id,team_id) VALUES(?,?,?)");
            for (const id of ids) insert.run(gameId, id, teamId);
          }
        });
        return reply(200, { ok: true });
      }
      const nameRoute = /^\/api\/games\/(\d+)\/name$/.exec(route);
      if (nameRoute && req.method === "POST") {
        admin(user);
        const row = game(Number(nameRoute[1]));
        const name = gameName(body.name);
        db.prepare("UPDATE games SET name=? WHERE id=?").run(name, row.id);
        return reply(200, { id: row.id, name });
      }
      const entryRoute = /^\/api\/games\/(\d+)\/entry$/.exec(route);
      if (entryRoute && req.method === "POST") {
        const gameId = Number(entryRoute[1]);
        const partner = body.partnerId === null ? null : Number(body.partnerId);
        if (partner !== null && (!Number.isSafeInteger(partner) || partner <= 0 || partner === user.id))
          throw new HttpError(400, "Choose a different available member.");
        transaction(db, () => {
          game(gameId);
          const current = db.prepare("SELECT * FROM entries WHERE game_id=? AND member_id=?").get(gameId, user.id);
          if (current?.partner_id) throw new HttpError(409, "You already have a partner for this date.");
          if (partner !== null) {
            if (!db.prepare("SELECT id FROM members WHERE id=?").get(partner)) throw new HttpError(400, "Member not found.");
            if (db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(gameId, partner)?.partner_id)
              throw new HttpError(409, "That member is no longer available. Choose another partner.");
          }
          const upsert = db.prepare("INSERT INTO entries(game_id,member_id,partner_id) VALUES(?,?,?) ON CONFLICT(game_id,member_id) DO UPDATE SET partner_id=excluded.partner_id");
          upsert.run(gameId, user.id, partner);
          if (partner !== null) upsert.run(gameId, partner, user.id);
        });
        return reply(200, { ok: true });
      }
      if (entryRoute && req.method === "DELETE") {
        const gameId = Number(entryRoute[1]);
        transaction(db, () => {
          game(gameId);
          db.prepare("UPDATE entries SET partner_id=NULL WHERE game_id=? AND partner_id=?").run(gameId, user.id);
          db.prepare("DELETE FROM entries WHERE game_id=? AND member_id=?").run(gameId, user.id);
        });
        return reply(200, { ok: true });
      }
      if (route === "/api/games" && req.method === "POST") {
        admin(user);
        const name = gameName(body.name);
        const eventType = body.eventType === undefined ? "pairs" : body.eventType;
        if (!["pairs", "teams"].includes(eventType)) throw new HttpError(400, "Choose Pairs or Teams.");
        const date = String(body.date || ""), time = String(body.time || "");
        const parsed = new Date(`${date}T12:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ||
            date < today() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
          throw new HttpError(400, "Choose a current or future date and a valid time.");
        if (db.prepare("SELECT id FROM games WHERE date=?").get(date)) throw new HttpError(409, "This playing date already exists.");
        const result = db.prepare("INSERT INTO games(date,time,name,event_type) VALUES(?,?,?,?)").run(date, time, name, eventType);
        return reply(201, { id: Number(result.lastInsertRowid), date, name, eventType });
      }
      if (route === "/api/members" && req.method === "POST") {
        admin(user);
        return reply(201, { id: addMember(db, body) });
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      if (!res.headersSent) reply(error.status || 500, { error: error.status ? error.message : "Something went wrong. Please try again." });
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 20000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.umask(0o077);
    const db = openDatabase();
    const server = createApp({ db, preview: process.env.PREVIEW_MODE === "1", previewToday: process.env.PREVIEW_TODAY });
    server.listen(Number(process.env.PORT || 5005), "0.0.0.0", () => console.log("CABC server ready."));
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
