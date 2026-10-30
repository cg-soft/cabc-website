# CABC registration and cancellation emails

Notifications default on for real members, with self-service opt-out.
Sender: **CABC Calendar <calendar@cabc.club>**.
SMTP: **mail.cabc.club:465**, authenticated implicit TLS with certificate
verification ([Nodemailer documentation](https://nodemailer.com/smtp)).
No password is included in source or public configuration.

SMTP never runs in a calendar request or at application startup. The app
queues messages and a separate, explicitly enabled worker delivers them.

## Notification rules

- Registration notifies each changed real participant, including a partner
  registered by someone else. Identical no-op and rejected requests send nothing.
- Cancellation tells the removed member they are cancelled, and an affected
  real partner that they remain registered and are now looking for a partner.
- Game cancellation/deletion considers all real registrants once, using game
  details saved before deletion. Every member's opt-out still applies.
- Administrator changes notify the affected members, not automatically the
  administrator, and identify the actor where appropriate. Deactivation may
  notify affected active partners; inactive accounts receive no further mail.
- Placeholders never receive mail. Guest, standby and unavailable assignments
  have wording appropriate to their actual status.
- Team changes alone, game edits/time changes, reminders and announcements are
  outside this release.

The outbox and calendar changes commit or roll back together. SMTP outages
do not block registration because sending happens separately.

## Preferences and opt-out links

**Email notifications** controls the signed-in member's preference, even when
an administrator is acting for someone else. Existing and new members default
On without rewriting existing member rows.

An emailed opt-out link opens a confirmation page; the recipient must press
**Stop emails**. No sign-in is needed, but GET requests and scanners cannot
change preferences. Re-enabling mail invalidates links in older messages.
Tokens are private capabilities, not session tokens, and cannot sign anyone in.

Before delivery, the worker rechecks preferences, account status and address.
Messages already being transmitted cannot be recalled. Messages over 48 hours
old, for past game dates, or superseded by registration/partnership/schedule
changes are skipped rather than delivering obsolete information.

## Deploy on Dathorn

Production remains owner-operated. Back up the existing private database first.
Keep the existing `DB_PATH`, `PUBLIC_DIR`, public symlink, `.htaccess` and
production `config.js`. Do not initialize or upload a replacement database.

Prepare dependencies on a trusted development machine using the release's
package files and a supported Node version:

```sh
npm ci --omit=dev --ignore-scripts
```

Nodemailer is pinned and pure JavaScript; there is no frontend build or native
compilation. While the app is stopped, upload these together into
`/home/cabc/src/cabc-minimal`:

```text
server.mjs
db.mjs
notifications.mjs
notification-schema.sql
migrate.mjs
mail-worker.mjs
package.json
package-lock.json
node_modules/nodemailer/   (complete package, including its dist directories)
```

Upload `public/app.js` directly to `/home/cabc/public_html/app.js`.
Do not replace the public symlink or upload private source under `public_html`.

From the application directory, with the existing production DB_PATH and
supported Node executable, run:

```sh
node migrate.mjs notifications
```

This repeatable, explicit migration adds only `notification_preferences`,
`notification_outbox`, an index and a migration marker. It reports before/after
counts of original tables, does not rewrite their rows and preserves the schema
version. Startup never migrates an existing database. Older installations need
the existing member-status/team migrations first.

Restart Node and check the calendar and Email notifications dialog. Without
the optional tables, new code still runs but hides preferences and queues no mail.

## Private SMTP configuration

Cron does not inherit the Node application manager's environment automatically.
Create a dedicated file such as `/home/cabc/private/cabc-mail.env`, outside both
the web root and source repository. Use **600** for the file and **700** for its
dedicated private directory; preserve working permissions on web-server paths.
Configure the password locally, never in chat, Git or `public/config.js`:

```text
EMAIL_ENABLED=0
DB_PATH=/REPLACE/WITH/THE/EXISTING/PRIVATE/club.sqlite
SMTP_HOST=mail.cabc.club
SMTP_PORT=465
SMTP_USER=calendar@cabc.club
SMTP_PASSWORD=SET_THIS_PRIVATELY
CABC_SITE_URL=https://cabc.club
MAIL_BATCH_SIZE=5
```

Replace the DB_PATH placeholder with the existing absolute database path.
Quote the password appropriately if it contains special characters. Node's
`--env-file` loads this private file
([Node documentation](https://nodejs.org/api/cli.html#--env-filefile)).

Confirm the mailbox exists, SPF/DKIM is correct and Dathorn's sending limits
permit the chosen rate. Exact mailbox settings appear in cPanel > Email Accounts
> Connect Devices ([cPanel instructions](https://docs.cpanel.net/cpanel/email/set-up-mail-client/96/)).
Actual Dathorn authentication and inbox delivery were not exercised during QA.

## Check, then enable

Use the actual absolute supported Node executable supplied by your host;
do not assume the login shell's `node` is the managed application's version.
This command reports counts without sending:

```sh
/ABSOLUTE/PATH/TO/node --env-file=/home/cabc/private/cabc-mail.env /home/cabc/src/cabc-minimal/mail-worker.mjs status
```

Review the queue and arrange an explicitly approved live test before enabling
member-wide mail. Then set `EMAIL_ENABLED=1` and add the host cron job:

```cron
*/5 * * * * umask 077; /ABSOLUTE/PATH/TO/node --env-file=/home/cabc/private/cabc-mail.env /home/cabc/src/cabc-minimal/mail-worker.mjs run >> /home/cabc/private/cabc-mail.log 2>&1
```

The default is at most five eligible messages per five minutes, not unlimited
sending. Confirm the host's limit before changing the schedule/batch. A database
lease prevents overlapping workers. The worker verifies TLS/authentication
without sending, then delivers individual messages; it logs generic status/errors,
not passwords, SMTP transcripts, recipient lists or opt-out tokens.
Preview mode and preview-marked databases are always refused.

## Failures and rollback

Safe preflight failures and explicit temporary SMTP rejections back off, with
at most five attempts. Authentication, certificate and permanent rejection
errors fail closed. Interrupted or ambiguous sends become **uncertain** and
are never automatically resent. SMTP acceptance and database acknowledgement
are separate operations: exactly-once inbox delivery cannot be guaranteed.

From the application directory, inspect failures without message bodies/tokens:

```sh
node --env-file=/home/cabc/private/cabc-mail.env mail-worker.mjs review
```

Check provider delivery logs before resetting an ID; its SMTP Message-ID is
`<ID@cabc.club>`. An explicit retry may duplicate an uncertain delivery:

```sh
node --env-file=/home/cabc/private/cabc-mail.env mail-worker.mjs retry ID --confirm-may-duplicate
```

To stop delivery, set `EMAIL_ENABLED=0` and disable cron. Stop the worker before
a code rollback, restore prior code/frontend and retain the additive tables.
Do not restore an old database over current registrations, reset the entire
queue indiscriminately or delete SQLite sidecar files.
