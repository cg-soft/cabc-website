// Dependency-free iCalendar export. Games store Pacific local start times only.
// No end time is invented: DTSTART without DTEND/DURATION is valid iCalendar.
const text = value => String(value)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
  .replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n")
  .replace(/;/g, "\\;").replace(/,/g, "\\,");

// RFC 5545: fold at 75 octets, never in the middle of a UTF-8 character.
function fold(line) {
  const parts = []; let current = "", bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 75) { parts.push(current); current = " "; bytes = 1; }
    current += character; bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}

export function registeredGamesCalendar(games, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Chinese American Bridge Club//Registered games//EN",
    "CALSCALE:GREGORIAN", "X-WR-CALNAME:CABC - My registered games",
    // Modern US Pacific daylight-saving rules, applicable to this club's future games.
    "BEGIN:VTIMEZONE", "TZID:America/Los_Angeles",
    "BEGIN:DAYLIGHT", "DTSTART:20070311T020000", "TZOFFSETFROM:-0800",
    "TZOFFSETTO:-0700", "TZNAME:PDT", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "DTSTART:20071104T020000", "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0800", "TZNAME:PST", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
    "END:VTIMEZONE"
  ];
  for (const game of games) {
    if (!Number.isSafeInteger(game.id) || game.id <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(game.date) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(game.time))
      throw new Error("Invalid game data for calendar export.");
    lines.push(
      "BEGIN:VEVENT",
      `UID:cabc-game-${game.id}-${game.date}@bridge.cabc.club`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/Los_Angeles:${game.date.replace(/-/g, "")}T${game.time.replace(":", "")}00`,
      `SUMMARY:${text(game.name || "Chinese American Bridge Club")}`,
      `DESCRIPTION:${text("Duplicate bridge at Chinese American Bridge Club.\nA snapshot of your registration. Check the club website for changes.")}`,
      "URL:https://bridge.cabc.club/#calendar",
      "CLASS:PRIVATE", "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
