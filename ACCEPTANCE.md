# New CABC website: acceptance checks

This is the fresh-start implementation, now replacing the old repository at the
owner's request. Keep the old live website, database and hosting deployment
unchanged until a separate deployment is authorized.

- Homepage: a full-screen photographic slideshow; exactly two visible buttons, About and Login. No marketing sections, sidebar, extra calls to action, or dashboard.
- Slideshow: two distinct illustrative images, readable controls at 375px and desktop, keyboard/hover/focus pause and reduced-motion support.
- About: intentional placeholder and a way home.
- Login: real member/admin authentication; clear errors and a clearly marked isolated preview shortcut using fictional data.
- Members: month calendar with playing dates, select a date, list all pairs, register with an available member or without a partner, cancel own registration with confirmation.
- Registration: never double-book either person; pairing registers both; cancelling removes the initiating member and leaves the other looking for a partner.
- Admin: same calendar; add a playing date and create a member using small dialogs. No separate dashboard.
- Security: private API rejects anonymous users, admin routes reject members, past-date writes and duplicate bookings reject, password hashes and session tokens are not exposed in calendar data.
- Persistence: SQLite data survives restart; no production records or old accounts are imported.
- Scope: plain browser files, Node built-ins only, no npm dependencies or build pipeline. Explicit database initialization.
- QA: desktop, 375px, short viewport, keyboard forms, invalid login, empty months, stale booking conflict, logout/reload, reduced motion, and the deployed backend proxy.
