# Chinese American Bridge Club: minimal new website

For iPhone home-screen installation, online-only behavior and the nine-file
upgrade, see [CABC Calendar on the iPhone Home Screen](HOME-SCREEN.md).

An independent replacement concept, not an update to the old application.

For the downloadable hosting package, start with [HOSTING.md](HOSTING.md).
It covers Dathorn-style settings, fresh administrator setup, minimal uploads,
UI-only updates, explicit schema handling and backups. No database or private
credentials are included, and no live hosting changes have been made.

Weekly encrypted backups are available through `backup.mjs`; follow
[BACKUPS.md](BACKUPS.md) to activate Sunday 03:00 cron runs on Dathorn, retaining
12 successful copies. The code does not install or activate a scheduler itself.

For existing installations upgrading to named games, follow
[UPGRADE-GAME-NAMES.md](UPGRADE-GAME-NAMES.md). Run the explicit
`node migrate.mjs game-names` migration against the existing private database
before starting the new server; do not rerun initialization.

To load members from a private CSV containing `name,email,initial-password`,
follow [IMPORT-MEMBERS.md](IMPORT-MEMBERS.md). The importer defaults to a dry run,
adds member accounts only, and never overwrites existing credentials.

## Act on behalf of members

Administrators can use Acting for to manage an active member's registrations,
partner or wildcard status, and teams without signing in as that member.
A named banner identifies the target; account controls and Export my games
remain the administrator's own. Normal scheduling rules and confirmations
apply, stale game revisions are rejected, and delegated writes are atomically
recorded in a private audit table. See
[ACTING-FOR-MEMBERS.md](ACTING-FOR-MEMBERS.md) for usage and the explicit
additive registration-audit migration required during the seven-file upgrade.

## Edit and delete games

Administrators select a current/future playing date, then choose Edit game
or Delete game on its dance card. Edit changes name, date and Pacific start
time while retaining every registration, partnership and team; event type
stays fixed. Delete reviews registered-member/team counts and requires an
explicit confirmation before removing that game and its registrations/teams.
Members cannot manage games, and past games remain read-only. Stale reviews
are rejected. See [GAME-MANAGEMENT.md](GAME-MANAGEMENT.md) for usage, limits,
calendar-snapshot warnings and the three-file, no-migration Dathorn upgrade.

## Deactivate members

Administrators can choose Deactivate member, select an account, review the
affected registrations/teams and explicitly confirm. Deactivation revokes
sessions, blocks login and partner selection, and cancels registrations for
today or later. Past records and names remain intact. The last active
administrator is protected; password resets, promotion and imports do not
reactivate inactive accounts.

Current installations upgrading to this release must first follow
[Deactivate members: usage and Dathorn upgrade](DEACTIVATE-MEMBERS.md), including
the explicit member-status migration, and then
[Wildcard placeholder members: usage and Dathorn upgrade](WILDCARDS.md) for
this release's four-file update. The older feature-specific upload
instructions below describe earlier releases, not a substitute for those upgrades.

## Wildcard placeholder members

The shared placeholder accounts `-Unavailable-`, `-Standby-` and `-Guest-` can be
overbooked: several members may use the same placeholder in one game.
`-Guest-` completes a playing pair and can form teams; `-Standby-` and
`-Unavailable-` are member states that cannot form teams or be chosen as a
partner. Placeholder accounts cannot sign in. A Show selector above the
calendar displays each placeholder's upcoming schedule across all months, with
jump buttons to the assigned games. This release changes `server.mjs`, `db.mjs`,
`public/app.js` and `public/style.css` only; no migration is required.

## Club logo

The shared page shell also displays the approved transparent club logo, fixed
at the upper left on every route. Its original PNG colors and alpha channel are
preserved. Headers reserve space for it while scrolling; mobile uses the logo
instead of duplicating the text wordmark. The logo adds no navigation button,
and the existing favicon and two-button slideshow home remain unchanged.

For just the logo update on a current team-events installation, upload
`public/club-logo.png`, `public/index.html`, `public/style.css` and `server.mjs`,
then restart and refresh. The server change permits serving the new PNG.
No new migration, dependencies or build is required for this visual update.

## Team events

Administrators can create either Pairs or Teams dates. In a team event, members
first register as pairs; either member of either pair can immediately combine
with one other complete, available pair to form a team of four. No acceptance
step is required.

The calendar identifies team dates and counts complete teams. The dance card
lists all teams, pairs seeking teammates, and individuals seeking partners.
Leaving a team preserves both pair registrations. Cancelling an individual
registration dissolves the team, leaving the other pair intact.

Existing installations must follow [TEAM-EVENTS.md](TEAM-EVENTS.md), including
the explicit `node migrate.mjs team-events` migration before starting the new
server. Existing dates remain Pairs. Startup never applies migrations; no build
or new dependency is required. Event type is fixed when a date is created.

## Export registered games

Signed-in members and administrators can select **Export my games** above the
calendar to download `cabc-my-games.ics`. The export includes their own
registrations for today or later across every month, including games where they
are still looking for a partner. Past and cancelled registrations are excluded.
If nothing qualifies, the site displays a message instead of downloading an
empty calendar.

Events include the game name (or club name when unnamed), Pacific start time,
and a link to the club website. No member names, emails, passwords or session
tokens are included. No duration is invented because games store start times
only. Stable event IDs identify the same games in repeated exports, but duplicate
handling depends on the calendar application.

Event website links now point to `https://cabc.club/#calendar`. Event IDs
intentionally retain their original `@bridge.cabc.club` suffix: this is a stable
identifier, not a navigation link. To install only this domain-link correction
on a site that already has export, upload `icalendar.mjs` and restart the app.
Existing downloaded/imported files are not edited by this change.

The file is a snapshot: later changes and cancellations are not automatically
synchronized. Apple documents importing .ics attachments from Mail in its
[iPhone calendar instructions](https://support.apple.com/guide/iphone/set-up-mail-contacts-and-calendar-accounts-ipha0d932e96/ios).
Google Calendar supports importing .ics files through Settings > Import & export
on a computer, as described in
[Google's import instructions](https://support.google.com/calendar/answer/37118?hl=en&co=genie.platform=desktop).
The serializer uses the timezone, escaping and line-folding rules in
[RFC 5545](https://www.rfc-editor.org/rfc/rfc5545).

For the original export-only release, upgrade an otherwise current installation by uploading **icalendar.mjs** (new),
**server.mjs** and **public/app.js**, then restart the Node application and refresh
the browser. Upload the new module before the server file. No build, dependency
installation, database initialization or schema migration is needed. See
[HOSTING.md](HOSTING.md) for the Dathorn paths.

For this newer team-events release, use [TEAM-EVENTS.md](TEAM-EVENTS.md) instead:
it also requires migration and additional files. The old export-only procedure
is not sufficient to install the current server over an unmigrated database.

## Scope

- A photographic slideshow homepage with exactly two buttons: About and Login.
- An intentional About placeholder.
- A real member/admin login.
- Export my games: an authenticated .ics download of personal registrations for today and later, across all months.
- One monthly calendar with playing dates and dance-card partnership registration.
- Optional game names on the calendar and dance cards, editable by administrators.
- Opens at the first month with a game today or later; month navigation skips gaps.
- A mobile playing-date list and a separate, clearly labeled dance-card panel.
- Members can register alone, choose an available partner, see all pairs for a date,
  and cancel their own registration.
- Administrators use the same calendar, with small dialogs to add a date or member.
- Team events combine two complete pairs immediately, with available-pair selection and safe team dissolution.

No announcements, document library, directory page, analytics, recurring-event
engine, invitation-email service, payments, or separate admin dashboard.

## Implementation

Plain HTML/CSS/browser JavaScript; a Node HTTP server; SQLite using Node's built-in
`node:sqlite`. No third-party runtime dependencies, ORM, transpiler, frontend
framework, bundler, or build step.

Tested with Node 22.23.2. Node 22 identifies its built-in SQLite module as
experimental; the tested version works without a native npm addon. Verify this
runtime on the eventual host before launch rather than assuming compatibility.
This repository now replaces the previous CABC application with a fresh-start
minimal implementation. The Dathorn installation and its database have not been
changed by this source replacement. Do not deploy over the old application or
reuse its database without following `HOSTING.md`.

The repository's `main` history was deliberately reset with the owner's approval.
If you have an old clone, preserve any local work outside it and make a fresh
clone rather than pulling or merging the old history into this implementation.

```text
public/             Only public HTML, CSS, JS and slideshow images
app.cjs             Production hosting entry point (direct or Passenger-loaded)
server.mjs          HTTP, authentication and calendar/registration endpoints
icalendar.mjs       Pacific-time iCalendar formatting for registered-game exports
export-tests.mjs    Export privacy, formatting, registration and session tests
db.mjs              Private storage and password helpers
schema.sql          Baseline database schema (new initialization also installs team schema)
team-schema.sql     Additive team membership table, index and protection triggers
member-status-schema.sql  Inactive-account and last-active-admin protection triggers
deactivation-tests.mjs    Migration, review, access, history, concurrency and backup checks
team-tests.mjs      Migration, formation, ownership, race, dissolution and backup checks
migrate.mjs         Explicit additive migrations for the minimal site
manage.mjs          Initialize, create fictional preview, reset a password, promote a member
manage-tests.mjs    Operator promotion, preservation and management regression tests
import-members.mjs  Validate/import private CSVs without replacing existing accounts
import-members-tests.mjs CSV validation, rollback, credential and persistence checks
tests.mjs           Isolated API and persistence tests
hosting-tests.mjs   Production launcher and simulated Passenger-loader checks
calendar-tests.mjs  Game names, migration safety and upcoming-month navigation
password-tests.mjs  Self-service password changes and session-revocation checks
backup.mjs          Encrypted SQLite backups and verified recovery copies
backup-tests.mjs    Backup encryption, retention, recovery and cron checks
data/               Private SQLite database; excluded from version control
```

The slideshow photographs are AI-generated illustrations of fictional spaces.
They do not depict the actual club venue or members. Replace
`public/slides/table.webp` and `room.webp` with authorized club photographs when
available.

## Fresh installation

Use Node 22.23.2. There is nothing to install or compile.

```bash
node manage.mjs init
node app.cjs
```

Initialization asks for the administrator's name and email in an interactive
terminal, creates a random password, and prints it once. Store it securely.
Do not run the application from a public web directory.

The default port is 5005. `PORT` and `DB_PATH` may be supplied through the hosting
environment; `.env` files are deliberately not loaded because there are no
dependencies. Keep `DB_PATH` outside all public/build directories.

The initial calendar is empty. The administrator adds actual playing dates and
members. New members receive their credentials through a private channel chosen
by the administrator; this app does not send email.

Normal startup checks the database schema and does not initialize or migrate it.
This is a new database model and does not import or upgrade the previous website.
There is no browser-based administrator-setup page. The production `app.cjs`
launcher refuses preview mode and fictional preview databases.

## Isolated preview

Use a separate, empty database:

```bash
DB_PATH=/private/path/preview.sqlite PREVIEW_TODAY=2026-10-20 node manage.mjs preview
DB_PATH=/private/path/preview.sqlite PREVIEW_MODE=1 PREVIEW_TODAY=2026-10-20 node server.mjs
```

Preview seeding creates fictional members and sample Monday games. The login
screen then offers member/admin preview access. These shortcuts intentionally
do not require a password, but only work when both the environment and database
explicitly mark the installation as a preview. They are disabled by default.

Never put real member data into this preview database or enable preview access
on a production account. The sandbox preview persists across server restarts,
but is not guaranteed durable hosting or a backup.

## Partnership rules

- A member may appear in only one partnership per date.
- Selecting a partner registers both members immediately. There is no separate
  invitation/acceptance workflow.
- The available-member dropdown excludes self and members already paired on
  the selected date. Unpaired or not-yet-registered members remain available.
- Selecting “I’m looking for a partner” registers only the signed-in member.
- Either partner may cancel their own registration; the other remains
  registered and becomes available for a new partnership.
- Past playing dates remain visible but cannot be changed through registration.
- Dates and daily cutoffs use America/Los_Angeles. Game times are Pacific time.

## Accounts and sessions

Passwords use salted scrypt; only password hashes and hashed session tokens are
stored. Private endpoints enforce server-side roles. Tokens expire after 12 hours.
The browser keeps its token only in memory, so reloading closes the browser
session and requires signing in again. This avoids cookie/storage requirements
in the private preview and is an intentional minimal implementation tradeoff.

Signed-in members and administrators can select **Change password** beside the
calendar controls. The form requires the current password, a different new
password of 12–128 characters, and matching confirmation. A successful change
stores a salted hash and revokes all sessions for that account, including the
current one, in a single transaction. The member returns to Login with a
confirmation and signs in using the new password; registrations are unchanged.
Wrong current passwords do not immediately sign the user out. Password-change
attempts are limited to five per account per 15 minutes; successful changes
clear that counter. This limiter is process-local, separate from login limits.

To deploy just this feature on an already-current installation, upload
`server.mjs`, `public/app.js` and `public/style.css`, then restart the Node app.
No additional database migration or dependency installation is required.
Fresh clones and older deployments must still follow any earlier game-name
migration requirements in `UPGRADE-GAME-NAMES.md`.

For a forgotten password, an operator can still reset a member or administrator:

```bash
node manage.mjs reset-password
```

The operator enters the account email. A new password is generated and existing
sessions for that account are revoked. The command does not send the password.

To grant an existing member administrator access, use an interactive terminal
with the live application's `DB_PATH`:

```bash
node manage.mjs promote
```

Enter the member's email at the prompt. Only their role changes; their password,
registrations and sessions remain intact. An unknown email is an error and does
not create an account. An existing administrator is reported without changes.
Ask the member to log out and log back in to show the administrator controls.
This is an operator command, not a member-facing API. It requires an existing
database and does not initialize or migrate one.

To deploy this command on an otherwise current installation, upload only
`manage.mjs`. No application restart, build or new dependency is required.

Login throttling is process-local and per connection IP; proxy users may share
an IP. This is suitable for review but should be checked with the hosting setup
before launch. No MFA, password-reset email, audit history, account-deletion UI,
or automatic session revocation on browser refresh is implemented.

## Deployment and updates

For a normal self-hosted installation, `public/config.js` uses the same-origin
API. Serve public files and `/api/` through the Node application, or have the
host route `/api/` to Node while serving only `public/` statically. Do not expose
the project root, database, schema, or management scripts.

Copy changed public files for a UI update. Copy changed server files and restart
Node for a server update. There is no build command or npm dependency install.
Never overwrite `data/`, local credentials, or host-generated routing files.
The existing Dathorn routing configuration has not been changed or verified.

Use HTTPS in production, restrict private file permissions, schedule consistent
encrypted SQLite backups, and test restoration. Stop writers and account for
SQLite WAL sidecars when making file-based backups.

The delivered preview uses a separate generated frontend folder whose API
placeholder is replaced by the preview hosting service. That folder is not the
production source and is excluded from Git.

## Checks

```bash
node --test tests.mjs
node --test hosting-tests.mjs
```

Tests use disposable databases and cover real login, role restrictions, privacy,
pair registration, cancellation, conflicting bookings, past dates, throttling,
session invalidation and reopening persisted data. See `ACCEPTANCE.md` for browser
checks. No real member accounts, production databases or external services are
used in testing.
