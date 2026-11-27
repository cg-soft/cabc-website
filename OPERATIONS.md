# Operations: install, upgrade and run

Production layout (Dathorn): application code in `~/src/cabc-minimal`, public files directly in `~/public_html`, the private database outside both. Nothing here is deployed automatically; every step on the server is manual.

## Layout and settings

| What | Where / value |
|---|---|
| Application directory | `/home/cabc/src/cabc-minimal` (all `.mjs`, `.cjs`, `.sql`, `package.json`) |
| Public directory | `/home/cabc/public_html` (the contents of `public/`: `index.html`, `app.js`, `style.css`, `config.js`, `web-app.js`, `pdf-viewer.mjs`, `manifest.webmanifest`, icons, `club-logo.png`, `slides/`, `help/`, `vendor/`) |
| Node | 22.13 or newer. Dathorn: `/opt/alt/alt-nodejs24/root/usr/bin/node`; use the absolute path in terminals and cron |
| Startup file | `app.cjs`, as the managed Node application's entry point |
| `PUBLIC_DIR` | Absolute path of the public directory, set on the managed application |
| `DB_PATH` | Absolute path of the live database, outside every public directory. Dathorn: `/home/cabc/src/cabc-minimal/private/cabc-minimal` |
| `PORT` | Default 5005 (the host normally supplies it) |

Never upload or overwrite the database, `config.js` routing, `.htaccess`, symlinks or `node_modules`. Do not run the app from a public directory. `app.cjs` refuses preview mode and fictional preview data. Startup checks the schema and never migrates.

Check the runtime once:

```bash
node --version
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); console.log(db.prepare('SELECT 1 AS ok').get())"
```

## First installation

```bash
cd /home/cabc/src/cabc-minimal
umask 077
export DB_PATH=/ABSOLUTE/PATH/TO/private/club.sqlite
node manage.mjs init     # asks for name and email, prints a random password once
```

Then add members through Add member in the browser, or in bulk with the importer. Start (or restart) the Node application.

## Upgrading

1. **Back up first** (`backup.mjs run`).
2. **Upload** the changed application files to the application directory and the changed `public/` files to the public directory. Uploading the whole set of runtime files is always safe; a partial upload must include every file the change touches. The backend files are `server.mjs`, `db.mjs`, `release.mjs`, `icalendar.mjs`, `notifications.mjs`, `documents.mjs`, `pdf-assets.mjs`, `manage.mjs`, `merge-member.mjs`, `pair-report.mjs`, `migrate.mjs`, `import-members.mjs`, `backup.mjs`, `mail-worker.mjs`, `app.cjs`, the `*.sql` schemas and `package.json`.
3. **Migrate** only when the release adds a table or column (below). Run each pending migration once with the same `DB_PATH`. They are additive, repeatable and report "already present" if installed.
4. **Restart** the Node application when any backend file changed. Website-only updates (`public/` files) need no restart; hard-refresh browsers.
5. **Verify**: `curl -I https://cabc.club/app.js` and `/style.css` should return 200 from the public directory, and About, Website version should show matching frontend and backend versions (see Versioning).

### Migrations

Run in this order on an older database; skip any already applied.

| Command | Adds | Needed for |
|---|---|---|
| `migrate.mjs game-names` | Game name column | Named games (required by everything else) |
| `migrate.mjs team-events` | Event type and team table | Teams dates |
| `migrate.mjs member-status` | Active flag and protection triggers | Deactivation (`demote` requires it) |
| `migrate.mjs registration-audit` | Audit table | Acting for |
| `migrate.mjs notifications` | Preferences and outbox | Email |
| `migrate.mjs documents` | Documents tables | Members-only PDFs |
| `migrate.mjs login-history` | Login history table | Sign-in history (sign-in works without it but records nothing) |

New databases created with `init` include everything. Features with no migration: placeholders and `-Director-`, My Own Dates, Export, Help, remembered sign-in, edit and delete games, the pair report and the member merge. `-Director-` needs the placeholder member created once through Add member.

Compatibility notes: the Director rule, remembered-session renewal and the slideshow image allowlist live in `server.mjs`, so those releases need the backend files and a restart, not just `public/`.

## Command reference

On Dathorn every command uses the same form (shown once; substitute the script and arguments):

```bash
cd /home/cabc/src/cabc-minimal
env DB_PATH=/home/cabc/src/cabc-minimal/private/cabc-minimal /opt/alt/alt-nodejs24/root/usr/bin/node manage.mjs promote
```

| Command | Notes |
|---|---|
| `manage.mjs init` | One time; refuses if an administrator exists |
| `manage.mjs reset-password` | Asks for the email, prints a new password once, ends that account's sessions; will not reactivate an inactive account |
| `manage.mjs promote` / `demote` | Asks for the email; ends the account's sessions. Demote requires typing `DEMOTE` and refuses to remove the last active administrator |
| `manage.mjs merge-member [--dry-run]` | Asks for the email to keep and the duplicate to retire; shows the plan; applying needs typing `MERGE`. Moves registrations, partner links and team places, refuses on conflicting bookings, deactivates the duplicate. Needs `merge-member.mjs`. Run the dry run first |
| `manage.mjs login-history [days]` | Last 30 days by default; needs the login-history migration |
| `manage.mjs pair-report [--played]` | Read-only; no migration or restart; needs `manage.mjs` and `pair-report.mjs` |
| `import-members.mjs FILE --dry-run` then `--apply` | CSV header `name,email,initial-password` (template in `examples/members-template.csv`); adds accounts only, never overwrites credentials; `--skip-existing` ignores known emails. `chmod 600` the CSV, delete it afterwards, and give members their passwords privately |
| `manage.mjs preview` | Fictional data for an isolated preview only (`PREVIEW_MODE=1`), never real data |

`manage.mjs` commands that change accounts need an interactive terminal.

## Backups

```bash
export DB_PATH=...  BACKUP_DIR=/home/cabc/private/cabc-minimal/backups
export BACKUP_KEY_PATH=/home/cabc/private/cabc-minimal/backup-key.hex  BACKUP_KEEP=12
node backup.mjs setup      # once: creates the key (store a copy elsewhere)
node backup.mjs run        # one encrypted backup now
node backup.mjs cron       # prints the Sunday 03:00 cron line to install
node backup.mjs verify BACKUP_FILE
node backup.mjs restore BACKUP_FILE /path/to/restore-check.sqlite   # never over production
```

Backups are encrypted copies of the live database (including documents and login history), keeping the last 12. The code does not install the cron job. Test a restore to a scratch file before relying on it.

## Email notifications

Notices are sent from `calendar@cabc.club`. The Reply-To is the email address of the member who triggered the notice (a partner, or an administrator acting for someone), so replies reach that person. Nothing reads replies on the site itself.

Registration and cancellation mail is queued by the app and sent by a separate worker; SMTP never runs inside a calendar request, so mail outages do not block registration.

1. Run `migrate.mjs notifications`, then `npm ci --omit=dev --ignore-scripts` to install `nodemailer` (upload `node_modules/nodemailer/` complete if you build elsewhere).
2. Create a private env file (for example `/home/cabc/private/cabc-mail.env`, mode 600), outside every public directory:

```text
EMAIL_ENABLED=0
DB_PATH=/ABSOLUTE/PATH/TO/live-database
SMTP_HOST=mail.cabc.club
SMTP_PORT=465
SMTP_USER=calendar@cabc.club
SMTP_PASSWORD=SET_THIS_PRIVATELY
CABC_SITE_URL=https://cabc.club
MAIL_BATCH_SIZE=5
```

3. Check with `node --env-file=/home/cabc/private/cabc-mail.env mail-worker.mjs status`, then set `EMAIL_ENABLED=1` and install the five-minute cron job:

```cron
*/5 * * * * umask 077; '/opt/alt/alt-nodejs24/root/usr/bin/node' --input-type=module -e 'import { readFileSync } from "node:fs"; import { parseEnv } from "node:util"; import { runWorker } from "/home/cabc/src/cabc-minimal/mail-worker.mjs"; try { const env = { ...process.env, ...parseEnv(readFileSync("/home/cabc/private/cabc-mail.env", "utf8")) }; console.log(new Date().toISOString(), await runWorker({ env })); } catch (error) { console.error(new Date().toISOString(), "Mail worker failed:", error.code || error.name); process.exitCode = 1; }' >> /home/cabc/private/cabc-mail.log 2>&1
```

4. If a message fails: `mail-worker.mjs review` lists problems; `mail-worker.mjs retry ID --confirm-may-duplicate` re-sends one (it may duplicate if the first attempt actually went out). To stop mail, set `EMAIL_ENABLED=0`.

Rules: the person acting is never notified of their own action; a real partner is told when registered or left without a partner; a member is told when someone else cancels for them; game deletion notifies registrants once; opt-outs always apply; placeholders never receive mail; reminders, announcements and game edits are not sent.

## Versioning

The frontend (`public/app.js`) and backend (`release.mjs`) carry separate version stamps, shown in About, Website version, which compares them with `/api/version`. After any application change, regenerate the stamps and test:

```sh
npm run release:version
npm test
```

Website-only releases change only the frontend stamp and need no restart; any backend change needs the backend files and a restart. A mismatch on the About page after an upload means a file was missed or the application was not restarted.

## Troubleshooting

- 404 for `app.js`, `config.js` or `style.css`: the public files are not in the public directory, or `PUBLIC_DIR` is wrong.
- "Incompatible database schema" or a migration message at startup: run the named migration with the same `DB_PATH`; startup never migrates.
- Commands report "Database not initialized": `DB_PATH` is relative, mistyped or points at a different file. Use the absolute live path and the absolute Node path.
- A feature seems missing after an upload: check the About version panel for a frontend/backend mismatch, then restart.
