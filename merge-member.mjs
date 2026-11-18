import { requireMemberStatus, transaction, wildcardType } from "./db.mjs";

const getMember = (db, email) => db.prepare("SELECT id,name,email,role,active FROM members WHERE email=?").get(email);
const sortMember = (a, b) => a.member_id - b.member_id;

function planMerge(db, keepEmail, retireEmail) {
  requireMemberStatus(db);
  const keep = getMember(db, keepEmail), retire = getMember(db, retireEmail);
  if (!keep || !retire) throw new Error("Both email addresses must match existing accounts.");
  if (keep.id === retire.id) throw new Error("Choose two different accounts.");
  if (wildcardType(keep.name) || wildcardType(retire.name)) throw new Error("Placeholder accounts cannot be merged.");
  if (keep.active !== 1 || retire.active !== 1) throw new Error("Both accounts must be active. Inactive accounts require manual review.");
  if (retire.role === "admin" && !db.prepare("SELECT name FROM members WHERE active=1 AND role='admin' AND id<>?")
    .all(retire.id).some(member => !wildcardType(member.name)))
    throw new Error("Cannot retire the last active administrator. Keep that login instead.");
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_members'").get())
    throw new Error("Team schema is missing. Upgrade the database before merging accounts.");

  const games = db.prepare(`SELECT g.id,g.date,g.name,g.event_type FROM games g WHERE EXISTS
    (SELECT 1 FROM entries e WHERE e.game_id=g.id AND (e.member_id=? OR e.partner_id=?)) ORDER BY g.date`)
    .all(retire.id, retire.id);
  const listEntries = db.prepare("SELECT member_id,partner_id FROM entries WHERE game_id=? ORDER BY member_id");
  const listTeams = db.prepare("SELECT member_id,team_id FROM team_members WHERE game_id=? ORDER BY member_id");
  const memberById = db.prepare("SELECT name,active FROM members WHERE id=?");
  const conflicts = [], changes = [];
  const replace = id => id === retire.id ? keep.id : id;
  for (const game of games) {
    const before = listEntries.all(game.id), teams = listTeams.all(game.id);
    const old = before.find(row => row.member_id === retire.id);
    const existing = before.find(row => row.member_id === keep.id);
    const incoming = before.filter(row => row.partner_id === retire.id);
    const teamOwner = teams.find(row => row.member_id === retire.id);
    const keepTeam = teams.find(row => row.member_id === keep.id);
    const conflict = reason => conflicts.push(`${game.date}: ${reason}`);
    if (old?.partner_id === keep.id || incoming.some(row => row.member_id === keep.id)) {
      conflict("the two accounts are paired with each other"); continue;
    }
    if (old && existing && (old.partner_id !== existing.partner_id || teamOwner || keepTeam)) {
      conflict("both accounts are assigned with different partners, teams, or availability statuses"); continue;
    }
    const partner = old?.partner_id == null ? null : memberById.get(old.partner_id);
    // Wildcard partners are not reciprocal. Any real partner must be the one
    // and only incoming reference. Never repair inconsistent data by guessing.
    if (!old || (old.partner_id !== null && !partner) ||
        (partner && !wildcardType(partner.name)
          ? incoming.length !== 1 || incoming[0].member_id !== old.partner_id
          : incoming.length !== 0)) {
      conflict("the duplicate's pair records do not agree"); continue;
    }
    if (partner && partner.active !== 1 && !existing) {
      conflict("the registration references an inactive partner"); continue;
    }
    if (teamOwner || incoming.some(row => teams.some(team => team.member_id === row.member_id))) {
      const group = teams.filter(row => teamOwner && row.team_id === teamOwner.team_id);
      const paired = new Map(before.map(row => [row.member_id, row.partner_id]));
      const ids = new Set(group.map(row => row.member_id));
      if (game.event_type !== "teams" || ids.size !== 4 || !ids.has(old.partner_id) ||
          [...ids].some(id => !ids.has(paired.get(id)) || paired.get(paired.get(id)) !== id)) {
        conflict("the team's pair records do not agree"); continue;
      }
    }
    const after = before.filter(row => row.member_id !== retire.id || !existing)
      .map(row => ({ member_id: replace(row.member_id), partner_id: replace(row.partner_id) })).sort(sortMember);
    const afterTeams = teams.map(row => ({ member_id: replace(row.member_id), team_id: row.team_id })).sort(sortMember);
    changes.push({ game, before, after, teams, afterTeams, duplicateEntry: !!existing, hasTeam: !!teamOwner,
      partnerName: partner?.name ?? null });
  }
  if (conflicts.length) throw new Error(`Merge blocked. No member records were changed:\n${conflicts.map(line => `  ${line}`).join("\n")}`);
  const hasOutbox = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notification_outbox'").get();
  const deliveries = hasOutbox ? db.prepare(`SELECT id,state FROM notification_outbox
    WHERE (member_id=? OR email=? COLLATE NOCASE) AND state IN ('pending','sending') ORDER BY id`).all(retire.id, retire.email) : [];
  if (deliveries.some(row => row.state === "sending"))
    throw new Error("A notification to the duplicate is in flight. Wait for the mail worker to finish, then retry.");
  const sessions = db.prepare("SELECT count(*) AS n FROM sessions WHERE member_id=?").get(retire.id).n;
  return { keep, retire, changes, deliveries, sessions, hasOutbox };
}

export function reviewMemberMerge(db, keepEmail, retireEmail) {
  db.exec("BEGIN");
  try {
    const plan = planMerge(db, keepEmail, retireEmail);
    db.exec("COMMIT");
    return plan;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function describeMemberMerge({ keep, retire, changes, deliveries, sessions }) {
  // Member and game labels come from the database. Keep terminal controls out
  // of the review prompt without changing their stored values.
  const clean = value => value.replace(/[\p{Cc}\p{Cf}]/gu, "?");
  const account = member => `${clean(member.name)} <${clean(member.email)}> (${member.role})`;
  const lines = [`Keep: ${account(keep)}`, `Retire: ${account(retire)}`,
    `${sessions} duplicate session(s) will be revoked; ${deliveries.length} queued notification(s) will be skipped.`];
  if (!changes.length) lines.push("No scheduled registrations to transfer.");
  for (const { game, duplicateEntry, hasTeam, partnerName } of changes) {
    const action = duplicateEntry ? "combine identical registrations" : "transfer registration";
    lines.push(`  ${game.date}${game.name ? ` (${clean(game.name)})` : ""}: ${action}${partnerName ? ` with ${clean(partnerName)}` : ""}${hasTeam ? "; keep intact team" : ""}`);
  }
  return lines.join("\n");
}

export function applyMemberMerge(db, reviewed) {
  transaction(db, () => {
    const current = planMerge(db, reviewed.keep.email, reviewed.retire.email);
    if (JSON.stringify(current) !== JSON.stringify(reviewed))
      throw new Error("Accounts, registrations, or queued notifications changed. Rerun the command and review the new plan.");
    const deleteEntry = db.prepare("DELETE FROM entries WHERE game_id=? AND member_id=?");
    const insertEntry = db.prepare("INSERT INTO entries VALUES(?,?,?)");
    const updatePartner = db.prepare("UPDATE entries SET partner_id=? WHERE game_id=? AND member_id=?");
    const listTeams = db.prepare("SELECT member_id,team_id FROM team_members WHERE game_id=? ORDER BY member_id");
    const insertTeam = db.prepare("INSERT INTO team_members VALUES(?,?,?)");
    for (const { game, before, after, afterTeams } of current.changes) {
      const previous = new Map(before.map(row => [row.member_id, row.partner_id]));
      deleteEntry.run(game.id, current.retire.id);
      for (const { member_id, partner_id } of after) {
        if (!previous.has(member_id)) insertEntry.run(game.id, member_id, partner_id);
        else if (previous.get(member_id) !== partner_id) updatePartner.run(partner_id, game.id, member_id);
      }
      // Deleting an entry or changing a partner can dissolve a whole team.
      // Restore only rows removed by those triggers, with the survivor ID.
      const remaining = new Set(listTeams.all(game.id).map(row => row.member_id));
      for (const row of afterTeams)
        if (!remaining.has(row.member_id)) insertTeam.run(game.id, row.member_id, row.team_id);
    }
    db.prepare("UPDATE members SET active=0,deactivated_at=?,deactivated_by=NULL WHERE id=?")
      .run(new Date().toISOString(), current.retire.id);
    if (current.hasOutbox) db.prepare(`UPDATE notification_outbox SET state='skipped',locked_until=NULL,
      last_error='Duplicate member account retired by operator.' WHERE (member_id=? OR email=? COLLATE NOCASE) AND state='pending'`)
      .run(current.retire.id, current.retire.email);
  });
}
