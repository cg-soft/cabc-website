import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { ROOT, openDatabase, passwordHash, passwordMatches, hashToken, transaction, addMember, clubToday, HttpError } from "./db.mjs";

export function createApp({ db = openDatabase(), preview = false, previewToday } = {}) {
  if (preview && db.prepare("SELECT value FROM metadata WHERE key='preview'").get()?.value !== "1")
    throw new Error("Preview access is restricted to an explicitly seeded preview database.");
  const today = () => preview && previewToday ? previewToday : clubToday();
  const dummy = passwordHash(randomBytes(32).toString("hex"));
  const attempts = new Map();
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
          "/slides/table.webp": "slides/table.webp", "/slides/room.webp": "slides/room.webp", "/favicon.png": "favicon.png" };
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
        return reply(200, { month, months, games, entries, members, user, today: currentDate });
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
        const date = String(body.date || ""), time = String(body.time || "");
        const parsed = new Date(`${date}T12:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ||
            date < today() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
          throw new HttpError(400, "Choose a current or future date and a valid time.");
        if (db.prepare("SELECT id FROM games WHERE date=?").get(date)) throw new HttpError(409, "This playing date already exists.");
        const result = db.prepare("INSERT INTO games(date,time,name) VALUES(?,?,?)").run(date, time, name);
        return reply(201, { id: Number(result.lastInsertRowid), date, name });
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
