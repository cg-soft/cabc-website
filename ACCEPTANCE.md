# New CABC website: acceptance checks

This is the fresh-start implementation, now replacing the old repository at the
owner's request. Keep the old live website, database and hosting deployment
unchanged until a separate deployment is authorized.

- Homepage: a full-screen photographic slideshow; exactly two visible buttons, About and Login. No marketing sections, sidebar, extra calls to action, or dashboard.
- Slideshow: two distinct illustrative images, readable controls at 375px and desktop, keyboard/hover/focus pause and reduced-motion support.
- About: intentional placeholder and a way home.
- Login: real member/admin authentication; clear errors and a clearly marked isolated preview shortcut using fictional data.
- Members: calendar opens at the earliest month with an upcoming game, skips empty/past-only months, shows optional game names, selects a date, lists all pairs, registers with an available partner or solo, and cancels with confirmation.
- Registration: never double-book either person; pairing registers both; cancelling removes the initiating member and leaves the other looking for a partner.
- Admin: same calendar; add a named or unnamed playing date, edit an upcoming game's name without changing partnerships, and create a member using small dialogs. No separate dashboard.
- Account: members and admins can change their own password with current-password verification and matching 12–128 character replacement; all own sessions are revoked on success, while registrations remain intact.
- Security: private API rejects anonymous users, admin routes reject members, past-date writes and duplicate bookings reject, password hashes and session tokens are not exposed in calendar data.
- Persistence: SQLite data survives restart; no production records or old accounts are imported.
- Scope: plain browser files, Node built-ins only, no npm dependencies or build pipeline. Explicit database initialization.
- QA: desktop, 375px, short viewport, keyboard forms, invalid login, empty months, stale booking conflict, logout/reload, reduced motion, and the deployed backend proxy.
