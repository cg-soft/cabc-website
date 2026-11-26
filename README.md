# Chinese American Bridge Club: calendar website

A small members-only calendar for the club's Monday duplicate games. Members register alone or with a partner; administrators manage dates, members and documents. Plain HTML/CSS/JavaScript, a Node server and SQLite (`node:sqlite`). No build step and no runtime dependencies other than optional email.

Installing, upgrading and operating it: [OPERATIONS.md](OPERATIONS.md). Behaviour specification: [FLOWS.md](FLOWS.md). Test and QA record: [QA.md](QA.md), [ACCEPTANCE.md](ACCEPTANCE.md).

## Who can do what

| | Members | Administrators (in the browser) | Command line only (operator) |
|---|---|---|---|
| Account | Sign in, optionally remember this device; change own password; email opt-out; Help; About | Everything members can do | Create first administrator, reset a forgotten password, promote, demote |
| Calendar | Register alone or with a partner, cancel own registration, see all pairs and teams for a date | Add, edit and delete games (Pairs or Teams) | |
| Show selector | All members, My Own Dates, `-Guest-`, `-Standby-`, `-Unavailable-`, `-Director-` schedules | | |
| Teams | Combine two complete pairs on a Teams date; leave a team | | |
| Export | Download own upcoming games as `.ics` | | |
| Documents | Open and download PDFs shared with all members | Upload, replace, delete, choose visibility | |
| Members | | Add a member, deactivate a member, reset a member's password | Bulk-import from CSV, merge duplicate accounts |
| On behalf of others | | Acting for: register, cancel and form teams for any active member; assign `-Director-` | |
| Reports | | | Login history, pair frequency |
| Maintenance | | | Database migrations, backups, email worker, release stamping |

Administrator status is never changed from the website: promotion and demotion are command-line only.

## Members

- **Sign in.** Email and password. Ordinary sessions last 12 hours and end on a full reload. The optional "Remember this device for 30 days" box keeps a secure cookie that renews on each visit, so a regularly used device stays signed in; a device idle for 30 days signs out. Logging out, a password change or reset, or deactivation ends remembered sessions. Use it only on a personal device.
- **Calendar.** Opens at the first month with a game today or later. Each game shows a pair count (team games count complete teams). Selecting a date shows its dance card with the registered pairs and anyone looking for a partner. Dates and cutoffs use Pacific time, and past games are read-only.
- **Partners.** Register alone ("I'm looking for a partner") or pick an available partner, which registers both immediately with no acceptance step. A member can be in one partnership per game. Either partner can cancel; the other stays registered and becomes available again.
- **Teams.** On a Teams date, register as a pair, then combine with one other complete pair to make a team of four. Leaving a team keeps both pair registrations; cancelling an individual dissolves the team and leaves the other pair intact.
- **Placeholders.** Shared accounts that cannot sign in and can be used by several members in one game: `-Guest-` completes a pair with an unregistered guest (and can form teams); `-Standby-` and `-Unavailable-` are member states that are not pairs, cannot form teams and cannot be picked as a partner. `-Director-` marks directing duty; everyone can see it, only administrators can register it, and it takes no pair or team slot.
- **Show.** Switches the calendar between all members, My Own Dates (every upcoming assignment across all months) and a placeholder's upcoming schedule.
- **Export my games.** Downloads `cabc-my-games.ics` with the member's own registrations from today onward (no names, emails or tokens). It is a snapshot and does not update when games change.
- **Email.** Registration and cancellation notices are on by default and each member can opt out, including from a link in the email. People are not notified of their own actions. Game cancellation is treated like a member cancellation. Mail comes from calendar@cabc.club.
- **Documents.** PDFs that administrators share with all members open in the page or download.
- **Help and About.** Help has an illustrated sign-in and partner guide. About has the club details, a collapsed Website version panel and a dated list of recent changes.
- **iPhone.** Safari, Share, Add to Home Screen, Open as Web App. It opens the calendar, needs a connection, and has its own sign-in separate from Safari: tick Remember this device inside the app.

## Administrators

Controls appear above the calendar after signing in as an administrator.

- **Add date / Edit game / Delete game.** Add a date with an optional name, Pacific start time (default 11:30) and Pairs or Teams type. Edit changes name, date and time and keeps every registration. Delete shows the affected registrations and needs confirmation. Past games cannot be changed. Event type is fixed at creation.
- **Add member.** Creates an account with a password you pass on privately; the site does not email passwords. Placeholders (`-Guest-`, `-Standby-`, `-Unavailable-`, `-Director-`) are ordinary members with those exact names, created once through Add member. `-Director-` is needed before directors can be assigned.
- **Deactivate member.** Review, then confirm. It signs the person out, blocks login and partner selection, and cancels registrations from today onward; past records and names stay. The last active administrator is protected, and password resets, promotion and imports never reactivate an account.
- **Reset member password.** Pick the member explicitly, enter your own password, and enter and confirm a new one (12 to 128 characters). It ends all of that member's sessions and does not force a change at next login.
- **Acting for.** Manage another active member's registration, partner or placeholder status and team without signing in as them. A banner names the target; your own account, password and document controls stay yours. Delegated changes are written to an audit table, and stale game reviews are rejected.
- **Documents.** Upload a PDF (10 MB each, 250 MB in total) with a title, optional description and visibility: Administrators only (default) or All members, which needs an explicit checkbox. Edit or replace, or delete with confirmation. Permissions follow the signed-in account, never Acting for.

## Command line

Run on the server in an interactive terminal from the application directory, with `DB_PATH` set to the live database. Commands are listed with their Dathorn form in [OPERATIONS.md](OPERATIONS.md#command-reference).

| Command | Purpose |
|---|---|
| `manage.mjs init` | Create the database and first administrator (one time) |
| `manage.mjs reset-password` | Generate a new password for any account (never emailed) |
| `manage.mjs promote` / `demote` | Grant or remove administrator access (demote needs typing `DEMOTE`; the last administrator is protected) |
| `manage.mjs merge-member [--dry-run]` | Merge a duplicate account into the one to keep, without losing registrations; the duplicate is retired, not deleted |
| `manage.mjs login-history [days]` | Successful sign-ins, newest first, Pacific time |
| `manage.mjs pair-report [--played]` | Registered pairs for upcoming dates with a count per pair; `--played` adds past games |
| `import-members.mjs FILE.csv --dry-run / --apply` | Bulk-add members from `name,email,initial-password` |
| `migrate.mjs NAME` | Explicit, additive database upgrades |
| `backup.mjs setup / run / cron / verify / restore` | Encrypted weekly backups |
| `mail-worker.mjs status / review / retry` | Email delivery |

## Limits to know

- Cancelled registrations leave no record, except changes made through Acting for (audit log). Reports count only registrations still in the database.
- Login history starts when its migration is installed.
- Login throttling is per process and per IP. There is no multi-factor sign-in and no forced password change.
- The slideshow shows two photo collages made from club photos.
