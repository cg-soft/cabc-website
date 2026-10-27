import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { registeredGamesCalendar } from "./icalendar.mjs";
import { ROOT, openDatabase, passwordHash, passwordMatches, hashToken, transaction, addMember, clubToday, HttpError, requireMemberStatus, wildcardType, WILDCARD_TYPES } from "./db.mjs";

export function createApp({ db = openDatabase(), preview = false, previewToday } = {}) {
  if (!db.prepare("PRAGMA table_info(games)").all().some(column => column.name === "event_type") ||
      !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_members'").get() ||
      db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('dissolve_team_before_entry_delete','dissolve_team_before_partner_change')").get().n !== 2)
    throw new Error("Team-events migration required. Run node migrate.mjs team-events with the same DB_PATH. Startup never migrates databases.");
  requireMemberStatus(db);
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
  const wildcardNames = Object.keys(WILDCARD_TYPES);
  function wildcardMembers() {
    return db.prepare(`SELECT id,name FROM members WHERE name IN (${wildcardNames.map(() => "?").join(",")})`).all(...wildcardNames);
  }
  function session(member) {
    if (!member || member.active !== 1) throw new HttpError(401, "Email or password is incorrect.");
    if (wildcardType(member.name)) {
      db.prepare("DELETE FROM sessions WHERE member_id=?").run(member.id);
      throw new HttpError(401, "This placeholder account cannot sign in.");
    }
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hashToken(token), member.id, Date.now() + 12 * 3600000);
    return { token, member: { id: member.id, name: member.name, role: member.role } };
  }
  function auth(req) {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, "Please sign in again.");
    const user = db.prepare("SELECT m.id,m.name,m.role FROM members m JOIN sessions s ON s.member_id=m.id WHERE s.hash=? AND s.expires>? AND m.active=1")
      .get(hashToken(token), Date.now());
    if (!user) throw new HttpError(401, "Your session has expired. Please sign in again.");
    if (wildcardType(user.name)) throw new HttpError(401, "This placeholder account cannot sign in.");
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
  function gameDateTime(date, time) {
    const parsed = typeof date === "string" ? new Date(`${date}T12:00:00Z`) : new Date(NaN);
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ||
        date < today() || typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new HttpError(400, "Choose a current or future date and a valid time.");
  }
  function gamePlan(id) {
    const current = game(id);
    const entries = db.prepare("SELECT * FROM entries WHERE game_id=? ORDER BY member_id").all(id);
    const teams = db.prepare("SELECT * FROM team_members WHERE game_id=? ORDER BY member_id").all(id);
    const registrationCount = entries.filter(entry => {
      const member = db.prepare("SELECT name FROM members WHERE id=?").get(entry.member_id);
      return member && !wildcardType(member.name);
    }).length;
    return {
      game: current, registrationCount, teamCount: new Set(teams.map(row => row.team_id)).size,
      revision: hashToken(JSON.stringify({ today: today(), game: current, entries, teams }))
    };
  }
  function schedulingSnapshot(gameId) {
    return {
      entries: db.prepare("SELECT * FROM entries WHERE game_id=? ORDER BY member_id").all(gameId),
      teams: db.prepare("SELECT * FROM team_members WHERE game_id=? ORDER BY member_id").all(gameId)
    };
  }
  function schedulingTarget(req, body, gameId) {
    const actor = auth(req);
    if (body.memberId === undefined) return { target: actor, actor };
    admin(actor);
    if (!Number.isSafeInteger(body.memberId) || body.memberId <= 0)
      throw new HttpError(400, "Choose a valid member to act for.");
    const target = db.prepare("SELECT id,name,active FROM members WHERE id=?").get(body.memberId);
    if (!target || target.active !== 1 || wildcardType(target.name))
      throw new HttpError(409, "That member is no longer available to act for. Return to Myself or choose another active member.");
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='registration_audit'").get())
      throw new HttpError(503, "Administrator scheduling requires the registration-audit migration. Run node migrate.mjs registration-audit with the same DB_PATH.");
    if (body.confirm !== true) throw new HttpError(400, "Confirm the scheduling action for the selected member.");
    const plan = gamePlan(gameId);
    if (body.revision !== plan.revision)
      throw new HttpError(409, "This game or its registrations changed. Refresh the calendar and review the action again.");
    return { actor, target, date: plan.game.date, before: schedulingSnapshot(gameId) };
  }
  function auditScheduling(context, gameId, action) {
    if (!context.before) return;
    db.prepare("INSERT INTO registration_audit(created_at,actor_id,actor_name,target_id,target_name,game_id,game_date,action,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(new Date().toISOString(), context.actor.id, context.actor.name, context.target.id, context.target.name,
        gameId, context.date, action, JSON.stringify(context.before), JSON.stringify(schedulingSnapshot(gameId)));
  }
  function completePair(gameId, memberId) {
    const row = db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(gameId, memberId);
    if (!row?.partner_id) throw new HttpError(409, "Both pairs must be fully registered. Refresh the calendar and try again.");
    const partner = db.prepare("SELECT name,active FROM members WHERE id=?").get(row.partner_id);
    const type = partner ? wildcardType(partner.name) : null;
    if (type) {
      // A guest placeholder completes a playing pair without a reciprocal row;
      // standby and unavailable are member states, not complete pairs.
      if (type !== "guest") throw new HttpError(409, "Unavailable and standby members cannot form teams.");
      if (partner.active !== 1) throw new HttpError(409, "A member is no longer active. Refresh the calendar and choose another pair.");
      return [memberId, row.partner_id];
    }
    const partnerRow = db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(gameId, row.partner_id);
    if (!partnerRow || partnerRow.partner_id !== memberId)
      throw new HttpError(409, "Both pairs must be fully registered. Refresh the calendar and try again.");
    if (db.prepare("SELECT count(*) AS n FROM members WHERE id IN (?,?) AND active=1").get(memberId, row.partner_id).n !== 2)
      throw new HttpError(409, "A member is no longer active. Refresh the calendar and choose another pair.");
    return [memberId, row.partner_id];
  }
  function deactivationPlan(id) {
    const member = db.prepare("SELECT id,name,email,role,active FROM members WHERE id=?").get(id);
    if (!member) throw new HttpError(404, "Member not found.");
    const date = today();
    const games = db.prepare("SELECT DISTINCT g.id,g.date,g.name,g.time FROM games g JOIN entries e ON e.game_id=g.id WHERE (e.member_id=? OR e.partner_id=?) AND g.date>=? ORDER BY g.date,g.id").all(id, id, date);
    const entries = db.prepare("SELECT e.* FROM entries e JOIN games g ON g.id=e.game_id WHERE g.date>=? AND (e.member_id=? OR e.partner_id=?) ORDER BY e.game_id,e.member_id").all(date, id, id);
    const teams = db.prepare("SELECT DISTINCT t.* FROM team_members t JOIN team_members a ON a.game_id=t.game_id AND a.team_id=t.team_id JOIN entries e ON e.game_id=a.game_id AND e.member_id=a.member_id JOIN games g ON g.id=e.game_id WHERE g.date>=? AND (e.member_id=? OR e.partner_id=?) ORDER BY t.game_id,t.team_id,t.member_id").all(date, id, id);
    const canDeactivate = member.active === 1 && !(member.role === "admin" && db.prepare("SELECT count(*) AS n FROM members WHERE role='admin' AND active=1").get().n <= 1);
    const isWildcard = !!wildcardType(member.name);
    const assignmentCount = isWildcard
      ? db.prepare("SELECT count(*) AS n FROM entries WHERE partner_id=? AND game_id IN (SELECT id FROM games WHERE date>=?)").get(id, date).n
      : null;
    const affectedGames = isWildcard
      ? db.prepare("SELECT count(DISTINCT game_id) AS n FROM entries WHERE partner_id=? AND game_id IN (SELECT id FROM games WHERE date>=?)").get(id, date).n
      : null;
    return { member, games, today: date, registrationCount: games.length, assignmentCount, isWildcard, affectedGames,
      teamCount: new Set(teams.map(t => `${t.game_id}:${t.team_id}`)).size, canDeactivate,
      revision: hashToken(JSON.stringify({ member, date, games, entries, teams })) };
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
        if (!member || !valid || member.active !== 1) throw new HttpError(401, "Email or password is incorrect.");
        return reply(200, transaction(db, () => {
          const current = db.prepare("SELECT * FROM members WHERE id=?").get(member.id);
          if (!current || current.password !== member.password) throw new HttpError(401, "Email or password is incorrect.");
          return session(current);
        }));
      }
      if (route === "/api/preview" && req.method === "POST") {
        if (!preview) throw new HttpError(404, "Not found.");
        limit(req);
        const email = body.role === "admin" ? "admin@preview.invalid" : "member@preview.invalid";
        return reply(200, transaction(db, () => session(db.prepare("SELECT * FROM members WHERE email=?").get(email))));
      }
      const user = auth(req);
      if (route === "/api/members/manage" && req.method === "GET") {
        admin(user);
        return reply(200, { members: db.prepare("SELECT id,name,email,role,active FROM members ORDER BY active DESC,name,email").all() });
      }
      const deactivateRoute = /^\/api\/members\/(\d+)\/deactivate$/.exec(route);
      if (deactivateRoute && ["GET", "POST"].includes(req.method)) {
        admin(user);
        const id = Number(deactivateRoute[1]);
        if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "Choose a valid member.");
        if (req.method === "GET") return reply(200, transaction(db, () => { admin(auth(req)); return deactivationPlan(id); }));
        if (body.confirm !== true || typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision))
          throw new HttpError(400, "Review the member and confirm deactivation first.");
        const result = transaction(db, () => {
          const actor = auth(req); admin(actor);
          const plan = deactivationPlan(id);
          if (plan.member.active === 0) return { ok: true, alreadyInactive: true, self: id === actor.id };
          if (!plan.canDeactivate) throw new HttpError(409, "You cannot deactivate the last active administrator.");
          if (plan.revision !== body.revision) throw new HttpError(409, "This member or their registrations changed. Review deactivation again.");
          // Remove future relationships before changing status. Existing team
          // triggers dissolve affected teams, leaving unaffected pairs intact.
          db.prepare("UPDATE entries SET partner_id=NULL WHERE partner_id=? AND game_id IN (SELECT id FROM games WHERE date>=?)").run(id, plan.today);
          db.prepare("DELETE FROM entries WHERE member_id=? AND game_id IN (SELECT id FROM games WHERE date>=?)").run(id, plan.today);
          db.prepare("UPDATE members SET active=0,deactivated_at=?,deactivated_by=? WHERE id=?")
            .run(new Date().toISOString(), actor.id, id);
          db.prepare("DELETE FROM sessions WHERE member_id=?").run(id);
          return { ok: true, self: id === actor.id, registrationCount: plan.registrationCount, teamCount: plan.teamCount };
        });
        return reply(200, result);
      }
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
        const wildcardRows = wildcardMembers();
        const wildcardIdList = wildcardRows.map(row => row.id);
        const notWildcardOwned = wildcardIdList.length
          ? ` AND e.member_id NOT IN (${wildcardIdList.map(() => "?").join(",")})` : "";
        const entries = month ? db.prepare(`SELECT e.game_id,e.member_id,e.partner_id,m.name FROM entries e JOIN members m ON m.id=e.member_id JOIN games g ON g.id=e.game_id WHERE g.date LIKE ?${notWildcardOwned} ORDER BY m.name`)
          .all(`${month}-%`, ...wildcardIdList) : [];
        // Only names and IDs needed for partnership selection, never member emails.
        const members = db.prepare("SELECT id,name,active FROM members ORDER BY name").all();
        // Placeholder schedules cover every upcoming month, not just the displayed one.
        const wildcards = wildcardRows.map(row => ({
          id: row.id, name: row.name, type: wildcardType(row.name),
          schedule: db.prepare(`SELECT g.id AS gameId,g.date,g.time,g.name AS gameName,g.event_type AS eventType,e.member_id AS memberId,m.name AS memberName FROM entries e JOIN games g ON g.id=e.game_id JOIN members m ON m.id=e.member_id WHERE e.partner_id=? AND g.date>=?${notWildcardOwned} ORDER BY g.date,g.time,g.id,m.name`)
            .all(row.id, currentDate, ...wildcardIdList)
        }));
        const teamRows = month ? db.prepare("SELECT t.game_id,t.team_id,t.member_id FROM team_members t JOIN games g ON g.id=t.game_id WHERE g.date LIKE ? ORDER BY t.team_id,t.member_id").all(`${month}-%`) : [];
        const groups = new Map();
        for (const row of teamRows) {
          const key = `${row.game_id}:${row.team_id}`;
          if (!groups.has(key)) groups.set(key, { id: row.team_id, game_id: row.game_id, memberIds: [] });
          groups.get(key).memberIds.push(row.member_id);
        }
        const registrationRevisions = user.role === "admin"
          ? Object.fromEntries(games.filter(g => g.date >= currentDate).map(g => [g.id, gamePlan(g.id).revision])) : undefined;
        return reply(200, { month, months, games, entries, members, teams: [...groups.values()], wildcards, user, today: currentDate, registrationRevisions });
      }
      const teamRoute = /^\/api\/games\/(\d+)\/team$/.exec(route);
      if (teamRoute && ["POST", "DELETE"].includes(req.method)) {
        const gameId = Number(teamRoute[1]);
        transaction(db, () => {
          const context = schedulingTarget(req, body, gameId);
          const user = context.target;
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
            const markerIds = new Set(wildcardMembers().map(w => w.id));
            // Distinct real members are required; two members may each bring a guest
            // represented by the same placeholder.
            const realIds = ids.filter(id => !markerIds.has(id));
            if (new Set(realIds).size !== realIds.length) throw new HttpError(400, "Choose a different pair to form a four-person team.");
            const occupied = db.prepare("SELECT member_id FROM team_members WHERE game_id=? AND member_id IN (?,?,?,?)").all(gameId, ...ids);
            if (occupied.length) throw new HttpError(409, "One of these pairs is already on a team. Refresh the calendar and choose again.");
            const teamId = randomBytes(16).toString("hex");
            const insert = db.prepare("INSERT INTO team_members(game_id,member_id,team_id) VALUES(?,?,?)");
            for (const id of realIds) insert.run(gameId, id, teamId);
          }
          auditScheduling(context, gameId, req.method === "DELETE" ? "leave-team" : "form-team");
        });
        return reply(200, { ok: true });
      }
      const gameManageRoute = /^\/api\/games\/(\d+)\/manage$/.exec(route);
      if (gameManageRoute && ["GET", "PATCH", "DELETE"].includes(req.method)) {
        admin(user);
        const id = Number(gameManageRoute[1]);
        if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "Invalid game.");
        const result = transaction(db, () => {
          admin(auth(req));
          const plan = gamePlan(id);
          if (req.method === "GET") return plan;
          if (typeof body.revision !== "string" || body.revision !== plan.revision)
            throw new HttpError(409, "This game or its registrations changed. Close this dialog and reopen it to review the latest game.");
          if (req.method === "DELETE") {
            if (body.confirm !== true) throw new HttpError(400, "Confirm deletion of this game.");
            db.prepare("DELETE FROM team_members WHERE game_id=?").run(id);
            db.prepare("DELETE FROM entries WHERE game_id=?").run(id);
            db.prepare("DELETE FROM games WHERE id=?").run(id);
            return { id, deleted: true };
          }
          const name = gameName(body.name);
          gameDateTime(body.date, body.time);
          if (body.eventType !== undefined && body.eventType !== plan.game.event_type)
            throw new HttpError(400, "Event type cannot be changed. Create a new game instead.");
          if (db.prepare("SELECT id FROM games WHERE date=? AND id<>?").get(body.date, id))
            throw new HttpError(409, "This playing date already exists.");
          db.prepare("UPDATE games SET name=?,date=?,time=? WHERE id=?").run(name, body.date, body.time, id);
          return { id, name, date: body.date, time: body.time, eventType: plan.game.event_type };
        });
        return reply(200, result);
      }
      const nameRoute = /^\/api\/games\/(\d+)\/name$/.exec(route);
      if (nameRoute && req.method === "POST") {
        admin(user);
        const name = gameName(body.name);
        const row = transaction(db, () => {
          admin(auth(req));
          const current = game(Number(nameRoute[1]));
          db.prepare("UPDATE games SET name=? WHERE id=?").run(name, current.id);
          return current;
        });
        return reply(200, { id: row.id, name });
      }
      const entryRoute = /^\/api\/games\/(\d+)\/entry$/.exec(route);
      if (entryRoute && req.method === "POST") {
        const gameId = Number(entryRoute[1]);
        const partner = body.partnerId === null ? null : Number(body.partnerId);
        if (partner !== null && (!Number.isSafeInteger(partner) || partner <= 0))
          throw new HttpError(400, "Choose a different available member.");
        transaction(db, () => {
          const context = schedulingTarget(req, body, gameId);
          const user = context.target;
          if (partner === user.id) throw new HttpError(400, "Choose a different available member.");
          game(gameId);
          const current = db.prepare("SELECT * FROM entries WHERE game_id=? AND member_id=?").get(gameId, user.id);
          if (current?.partner_id) throw new HttpError(409, "You already have a partner for this date.");
          let partnerIsPlaceholder = false;
          if (partner !== null) {
            const partnerMember = db.prepare("SELECT id,name,active FROM members WHERE id=?").get(partner);
            if (!partnerMember || partnerMember.active !== 1) throw new HttpError(409, "That member is no longer available. Choose another partner.");
            partnerIsPlaceholder = !!wildcardType(partnerMember.name);
            if (partnerIsPlaceholder) {
              // Overbookable placeholder: the assignment is stored once, from the
              // real member to the placeholder. Remove any legacy reciprocal row
              // this placeholder owns so the assignment cannot be stored twice.
              db.prepare("DELETE FROM entries WHERE game_id=? AND member_id=? AND (partner_id IS NULL OR partner_id=?)").run(gameId, partner, user.id);
            } else if (db.prepare("SELECT partner_id FROM entries WHERE game_id=? AND member_id=?").get(gameId, partner)?.partner_id) {
              throw new HttpError(409, "That member is no longer available. Choose another partner.");
            }
          }
          const upsert = db.prepare("INSERT INTO entries(game_id,member_id,partner_id) VALUES(?,?,?) ON CONFLICT(game_id,member_id) DO UPDATE SET partner_id=excluded.partner_id");
          upsert.run(gameId, user.id, partner);
          if (partner !== null && !partnerIsPlaceholder) upsert.run(gameId, partner, user.id);
          auditScheduling(context, gameId, "register");
        });
        return reply(200, { ok: true });
      }
      if (entryRoute && req.method === "DELETE") {
        const gameId = Number(entryRoute[1]);
        transaction(db, () => {
          const context = schedulingTarget(req, body, gameId);
          const user = context.target;
          game(gameId);
          // Remove legacy reciprocal rows owned by placeholders that point back at
          // this member, so a cancelled assignment disappears completely.
          const markerIds = wildcardMembers().map(w => w.id);
          if (markerIds.length)
            db.prepare(`DELETE FROM entries WHERE game_id=? AND member_id IN (${markerIds.map(() => "?").join(",")}) AND partner_id=?`).run(gameId, ...markerIds, user.id);
          db.prepare("UPDATE entries SET partner_id=NULL WHERE game_id=? AND partner_id=?").run(gameId, user.id);
          db.prepare("DELETE FROM entries WHERE game_id=? AND member_id=?").run(gameId, user.id);
          auditScheduling(context, gameId, "cancel");
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
        const result = transaction(db, () => {
          admin(auth(req));
          if (db.prepare("SELECT id FROM games WHERE date=?").get(date)) throw new HttpError(409, "This playing date already exists.");
          return db.prepare("INSERT INTO games(date,time,name,event_type) VALUES(?,?,?,?)").run(date, time, name, eventType);
        });
        return reply(201, { id: Number(result.lastInsertRowid), date, name, eventType });
      }
      if (route === "/api/members" && req.method === "POST") {
        admin(user);
        return reply(201, { id: transaction(db, () => { admin(auth(req)); return addMember(db, body); }) });
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
