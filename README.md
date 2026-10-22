# Chinese American Bridge Club: minimal new website

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

## Scope

- A photographic slideshow homepage with exactly two buttons: About and Login.
- An intentional About placeholder.
- A real member/admin login.
- One monthly calendar with playing dates and dance-card partnership registration.
- Optional game names on the calendar and dance cards, editable by administrators.
- Opens at the first month with a game today or later; month navigation skips gaps.
- A mobile playing-date list and a separate, clearly labeled dance-card panel.
- Members can register alone, choose an available partner, see all pairs for a date,
  and cancel their own registration.
- Administrators use the same calendar, with small dialogs to add a date or member.

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
db.mjs              Private storage and password helpers
schema.sql          Explicit initial database schema
migrate.mjs         Explicit additive migrations for the minimal site
manage.mjs          Initialize, create fictional preview, reset a password
tests.mjs           Isolated API and persistence tests
hosting-tests.mjs   Production launcher and simulated Passenger-loader checks
calendar-tests.mjs  Game names, migration safety and upcoming-month navigation
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

To reset a member or administrator password:

```bash
node manage.mjs reset-password
```

The operator enters the account email. A new password is generated and existing
sessions for that account are revoked. The command does not send the password.

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
