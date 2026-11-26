import { wildcardType } from "./db.mjs";

// Read-only: registered pairs for upcoming games and how often each pair appears.
// Real pairs are stored as two rows (one per member); a guest pair as one row.
export function upcomingPairs(db, today, all = false) {
  const games = db.prepare(`SELECT id,date,time,name,event_type FROM games ${all ? "" : "WHERE date>=?"} ORDER BY date,time,id`).all(...(all ? [] : [today]));
  const rows = db.prepare(`SELECT e.member_id, m.name AS member, e.partner_id, p.name AS partner
    FROM entries e JOIN members m ON m.id=e.member_id LEFT JOIN members p ON p.id=e.partner_id WHERE e.game_id=?`);
  const frequency = new Map();
  const report = games.map(game => {
    const pairs = [], alone = [], seen = new Set();
    for (const row of rows.all(game.id)) {
      const mine = wildcardType(row.member), theirs = wildcardType(row.partner);
      if (mine === "director" || mine === "standby" || mine === "unavailable") continue;
      if (theirs === "standby" || theirs === "unavailable" || theirs === "director") continue;
      if (row.partner_id === null) { if (!mine) alone.push(row.member); continue; }
      if (mine) continue;
      const names = theirs === "guest" ? [row.member, "-Guest-"] : [row.member, row.partner].sort((a, b) => a.localeCompare(b));
      const key = theirs === "guest" ? `g:${row.member_id}` : [row.member_id, row.partner_id].sort((a, b) => a - b).join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      const label = names.join(" & ");
      pairs.push({ key, label });
      const entry = frequency.get(key) || { label, count: 0, played: 0, upcoming: 0, last: null };
      entry.count++; frequency.set(key, entry);
      if (game.date < today) { entry.played++; entry.last = game.date; } else entry.upcoming++;
    }
    pairs.sort((a, b) => a.label.localeCompare(b.label));
    return { ...game, pairs, alone: alone.sort((a, b) => a.localeCompare(b)) };
  });
  const totals = [...frequency.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { report, totals };
}
export function describePairs({ report, totals }) {
  if (!report.length) return "No upcoming games.";
  const lines = [];
  for (const g of report) {
    lines.push(`${g.date} ${g.time}${g.name ? ` ${g.name}` : ""}${g.event_type === "teams" ? " [teams]" : ""} - ${g.pairs.length} ${g.pairs.length === 1 ? "pair" : "pairs"}`);
    for (const p of g.pairs) lines.push(`  ${p.label}`);
    if (g.alone.length) lines.push(`  Looking for a partner: ${g.alone.join(", ")}`);
  }
  lines.push("", "Registered upcoming dates per pair:");
  for (const t of totals) lines.push(`${String(t.count).padStart(3)}  ${t.label}`);
  if (!totals.length) lines.push("  (no pairs registered)");
  return lines.join("\n");
}
export function describePlayed({ report, totals }, today) {
  const games = report.filter(g => g.date < today).length;
  const lines = [`Pairs registered together, all games on record (${report.length} games: ${games} past, ${report.length - games} upcoming):`,
    "Past  Upcoming  Last played  Pair"];
  for (const t of totals.sort((a, b) => b.played - a.played || b.upcoming - a.upcoming || a.label.localeCompare(b.label)))
    lines.push(`${String(t.played).padStart(4)}  ${String(t.upcoming).padStart(8)}  ${(t.last || "-").padEnd(11)}  ${t.label}`);
  if (!totals.length) lines.push("  (no pairs registered)");
  return lines.join("\n");
}
