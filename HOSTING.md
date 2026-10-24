# CABC Minimal Website: Hosting Instructions

This package contains the new, minimal website with the revised calendar.
It is not an in-place upgrade of the previous React/Express site or its database.
Nothing has been uploaded to Dathorn, and the existing live site is unchanged.

## What to upload

The complete ZIP includes readable source, tests and documentation. The minimum
runtime upload is:

```text
app.cjs
server.mjs
icalendar.mjs
db.mjs
manage.mjs
schema.sql
migrate.mjs
package.json
public/
  index.html
  favicon.png
  config.js
  app.js
  style.css
  slides/table.webp
  slides/room.webp
```

There is no build step, node_modules directory, esbuild, drizzle-kit, or
better-sqlite3 dependency. SQLite is supplied by Node's built-in `node:sqlite`.
Do not run `npm ci`; this dependency-free package intentionally has no lockfile.
No database, accounts, credentials, or preview deployment folder is included.

## Confirm the host runtime first

### Existing installation: registered-game export update

For an otherwise current installation, upload these files:

```text
icalendar.mjs  -> /home/cabc/src/cabc-minimal/icalendar.mjs
server.mjs     -> /home/cabc/src/cabc-minimal/server.mjs
public/app.js  -> /home/cabc/src/cabc-minimal/public/app.js
```

Upload the new `icalendar.mjs` before `server.mjs`, then restart the application
through Dathorn and refresh the browser. No build, new dependency, database
initialization or migration is needed. Do not replace the private database.
Keep `DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite` unchanged.

After signing in, choose **Export my games**. The `cabc-my-games.ics` download
contains only that account's registered games for today or later, across all
months. An account without upcoming registrations sees a message instead.
The file is a snapshot, not a subscription. No production hosting changes are
made by a repository push.

### Runtime verification

Use the Node environment activation command supplied by your hosting control
panel, then run these commands in its terminal:

```bash
node --version
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); console.log(db.prepare('SELECT 1 AS ok').get()); db.close()"
```

The second command must print an object with `ok: 1`. The package is tested
locally on Node 22.23.2; use that runtime if available and repeat the check for
any different version. Node 22 emits an experimental SQLite warning in our
tests; a warning is not the same as a binding failure.

Do not install the old site's SQLite addon to fix this package. If `node:sqlite`
is unavailable in the selected host binary, ask Dathorn for a compatible runtime
before proceeding. The shell and web application must select the same runtime.

## Suggested paths and control-panel settings

These are proposed paths, not statements about the current server configuration.
Use a new folder so the previous application remains recoverable:

| Setting | Suggested value |
| --- | --- |
| Application root | `/home/cabc/src/cabc-minimal` |
| Application startup file | `app.cjs` |
| Application mode | Production |
| Public document root, if independently configurable | `/home/cabc/src/cabc-minimal/public` |
| Private database | `/home/cabc/private/cabc-minimal/club.sqlite` |
| Application URL, once ready to switch | `https://bridge.cabc.club/` |

If the application-root field expects a path relative to the home directory,
enter `src/cabc-minimal`, not the full absolute path. Do not change the live
domain mapping until a test installation has passed the checks below.

The URL belongs at the domain root `/`. This package does not implement the
previously cancelled `/bridge` path deployment. Pages use hash routes such as
`/#login`; there is no `/admin/setup` page.

Use the host's Node application manager to map requests to the application.
Pointing a static document root at `public/` alone will not start the backend.
Both `/api/*` and the public site must be reachable on the same origin.
Only `public/` may be served directly by the web server; never expose the
application root or the private database directory.

The included `app.cjs` loads the ES modules and explicitly starts the HTTP server,
including when a host loads the startup file rather than executing it directly.
For Passenger, it uses explicit `configure({autoInstall:false})` and
`listen('passenger')` routing, following the
[Passenger reverse-port-binding documentation](https://www.phusionpassenger.com/library/indepth/nodejs/reverse_port_binding.html).
Actual Dathorn/Passenger integration must still be tested on your account.
No account-specific `.htaccess` is included; preserve host-generated routing
files and ask Dathorn to confirm the root/startup mapping if the API returns 404.

## Initialize a fresh database and administrator

Before starting the application, open an interactive terminal using the selected
Node environment. The commands below assume the suggested paths:

```bash
cd /home/cabc/src/cabc-minimal
umask 077
mkdir -p /home/cabc/private/cabc-minimal
chmod 700 /home/cabc/private/cabc-minimal
export DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite
node manage.mjs init
```

Enter the real administrator email and name at the prompts. Save the generated
password in a password manager; do not put it into source files or shared logs.
The command requires a real interactive terminal, not a control-panel command
runner without terminal input. Do not upload the sandbox database or use
`node manage.mjs preview` for production.

Set these variables in the web application's control-panel environment as well:

```text
NODE_ENV=production
DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite
```

Leave `PREVIEW_MODE` and `PREVIEW_TODAY` unset. An `export` in an SSH session does
not automatically configure the control-panel-managed process. `.env` files are
not loaded by this application.

For a manually managed process, run `node app.cjs` and configure the reverse
proxy to the chosen `PORT` (default 5005). For Passenger, use `app.cjs` in the
application manager; it handles the internal socket rather than requiring you
to expose port 5005. Do not run two competing services for the same application.

The first calendar is intentionally empty. Sign in through Login, then use Add
date and Add member. Add each Monday at 11:30 am as an individual playing date;
this minimal version does not generate recurring dates automatically.

## Upload and update workflow

Use SFTP or rsync over SSH if those are enabled on your account. The examples
below are templates: substitute the SSH host and confirm the destination before
running them. For a nonstandard SSH port, add `-e 'ssh -p YOUR_PORT'`.

From the extracted source folder, preview the initial runtime upload:

```bash
rsync -avzn app.cjs server.mjs icalendar.mjs db.mjs manage.mjs migrate.mjs schema.sql package.json public \
  cabc@YOUR_SSH_HOST:/home/cabc/src/cabc-minimal/
```

Create the destination directory first. Review the dry-run output, then remove
the `n` from `-avzn` to transfer. No `--delete` is used, and the private database
is outside the upload destination.

For normal UI-only changes:

```bash
rsync -avzn public/ \
  cabc@YOUR_SSH_HOST:/home/cabc/src/cabc-minimal/public/
```

Review and repeat with `-avz`. Upload all changed frontend files together;
schedule a quiet period if a change requires matching JavaScript and HTML.
There is no compilation, dependency installation, or native-addon rebuild.
The Node server reads public files on each request, so UI-only changes normally
need no application restart. Clear any host-side cache if stale files appear.

For server changes, upload the matching server files during a maintenance
window and restart through the application manager. Keep a copy of the prior
source release for rollback. Never replace a populated database with a local
development or preview database.

### Explicit schema policy

Initialization is explicit, and normal startup only validates the schema; it
does not run migrations. Baseline schema version 1 is retained for compatibility.
The optional game-name column has an explicit additive migration and metadata
record; see [UPGRADE-GAME-NAMES.md](UPGRADE-GAME-NAMES.md).

Do not rerun initialization as a schema-update procedure. Back up first, stop
writers, run `node migrate.mjs game-names` with the correct DB_PATH, verify
unchanged row counts, then start the matching server release. There is still
no migration from the superseded React website's database.

## Backups, recovery and rollback

Store databases and backup copies outside every web-accessible directory.
The application restricts the database file to mode 600; its parent should be
700 and writable by the application account. Do not solve permission errors
with `chmod 777`.

Arrange a consistent SQLite backup using a database-aware backup tool, or stop
all application writers before a filesystem backup. Account for `-wal` and
`-shm` sidecars; copying only the main file while writes are active can omit
committed data. Encrypt backups, keep a separate-host copy, and test restoration
into a private test environment. See [BACKUPS.md](BACKUPS.md) for the encrypted
weekly backup utility and activation steps for this installation. The cron
entry must still be enabled on Dathorn.

A source-only rollback is safe only if it supports the current database schema.
Never blindly restore an older database over current member registrations.
Before a database restore, stop the service, preserve the current database and
sidecars, then follow the restore tool's consistent restore procedure.

For a forgotten account password, use the same `DB_PATH` as the live service:

Members who know their current password can instead use **Change password**
beside the signed-in calendar controls. A successful change signs out all their
sessions, including the current one, and leaves registrations unchanged.
Forgotten passwords still require administrator assistance using this command:

```bash
node manage.mjs reset-password
```

Enter the account email, save the generated replacement password, and deliver it
privately. The command revokes that account's existing sessions.

### Promote an existing member

Upload the updated `manage.mjs` into the application directory. In Dathorn's
terminal, activate the application's Node environment, then run:

```bash
cd /home/cabc/src/cabc-minimal
export DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite
node manage.mjs promote
```

Enter the member's email when prompted. The command grants administrator access
to that existing account only. It preserves passwords, registrations and
sessions, safely reports an account that is already an administrator, and rejects
an unknown email without creating an account. The member should log out and
log back in to see the administrator controls. No restart, build, dependency
installation or schema migration is needed for this update.

## Launch checklist and troubleshooting

- Enable HTTPS and verify the certificate and HTTP-to-HTTPS redirect.
- `GET /api/config` must return JSON with `"preview":false` and the current
  Pacific date. HTML or a 404 here means the Node/API mapping is wrong.
- The home page must show exactly About and Login; About remains a placeholder.
- Login must not offer preview shortcuts. A fresh production database contains
  only the administrator you initialized.
- Sign in as administrator, add a real game date and authorized member, then
  verify a member login and registration on desktop and phone.
- Confirm pairing registers both members and cancellation leaves the former
  partner looking for a partner. Do not mistake that behavior for data loss.
- Confirm `/db.mjs`, `/schema.sql`, `/app.cjs` and any private storage paths are
  not publicly downloadable.
- Restart the managed application and confirm registrations persist.
- Establish a backup schedule, recovery owner and tested restore procedure.

If startup says the database is not initialized, verify `DB_PATH` in both the
terminal and the application manager. If the homepage works but login/calendar
requests return 404, fix API routing rather than editing the frontend. If the
hosting manager shows no useful log, ask the provider where its Passenger or
Node error output is captured; the application writes startup failures to stderr.

Passwords are hashed, but the database is not encrypted at rest. Login throttling
is process-local and based on connection IP; a shared proxy can make users share
the same limit. Signed-in password changes have a separate per-account,
process-local limit of five attempts per 15 minutes. MFA, self-service forgotten-
password recovery, member removal, email delivery,
and audit logging are not included. Browser refresh requires signing in again.
These limitations and the host-specific runtime/routing checks should be
reviewed before inviting members.
