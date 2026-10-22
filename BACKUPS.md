# CABC weekly database backups

Policy: every Sunday at 03:00 in the hosting server's timezone, keeping the
latest 12 successful backups in a private Dathorn folder. **Scheduling is not
active until you add the cron job in Dathorn.**

## Installation paths

| Purpose | Path |
| --- | --- |
| Application | `/home/cabc/src/cabc-minimal` |
| Live database | `/home/cabc/private/cabc-minimal/club.sqlite` |
| Encrypted backups | `/home/cabc/private/cabc-minimal/backups` |
| Recovery key | `/home/cabc/private/cabc-minimal/backup-key.hex` |

The utility uses SQLite's online backup API, including committed WAL records,
instead of copying the live main file. Each snapshot is checked for database
integrity, encrypted with AES-256-GCM, decrypted into a temporary verification
copy and checked again. Only then is it published and retention applied.
Failed snapshots do not trigger pruning. Manual successful runs count toward
the same 12-copy limit.

## Activate once on Dathorn

Upload `backup.mjs` from the updated repository into the application directory.
It imports the existing `db.mjs`; no npm install, website restart or schema
migration is needed. Updated documentation, tests and `package.json` can also
be uploaded but are not required to run the utility directly.

In Dathorn's terminal, run the Node environment activation command shown in the
application settings. Use the same compatible Node binary as the site; the
backup utility was tested on Node 22.23.2. Then run:

```bash
cd /home/cabc/src/cabc-minimal
export DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite
export BACKUP_DIR=/home/cabc/private/cabc-minimal/backups
export BACKUP_KEY_PATH=/home/cabc/private/cabc-minimal/backup-key.hex
export BACKUP_KEEP=12
node backup.mjs setup
node backup.mjs run
node backup.mjs cron
```

`setup` generates the recovery key on your server, never in GitHub or a chat.
It neither prints the key nor replaces an existing key. The live database is
not initialized, reset or migrated. Private directories must be mode 700;
the database and key must be mode 600 or stricter. If a permission check fails,
review ownership and fix only the specific private path. Never use `chmod 777`.
Missing keys are not silently regenerated when existing backups are present.

**Save the key securely offline**, separately from the backup files, for example
in a password manager. Without the original key, backups cannot be decrypted.
Do not commit the key to GitHub or paste it into chat.

`run` must print `CABC backup verified` followed by an encrypted backup filename.
`cron` prints a complete cron line using the exact Node executable from this
terminal session and explicit paths, so it does not depend on an interactive
shell or the web application's environment variables.

In Dathorn's Cron Jobs interface, enter:

| Field | Value |
| --- | --- |
| Minute | `0` |
| Hour | `3` |
| Day of month | `*` |
| Month | `*` |
| Day of week | `0` |
| Command | Everything **after** the initial `0 3 * * 0 ` in the printed line |

If editing a crontab directly, use the complete printed line instead. Add only
one copy of the job. The time follows the hosting cron service's timezone,
not the site's Pacific calendar. Confirm that timezone with Dathorn if needed.

Configure a monitored cron-output email in the control panel if available,
using your chosen address. Do not discard errors with `>/dev/null 2>&1`.
The utility exits nonzero on failure and times out after ten minutes.
Node's experimental SQLite warning alone is not a backup failure.
No email recipient or external notification service has been configured for you.

## Verify recovery without touching production

Substitute the exact filename printed by a successful run for `BACKUP_FILE`.
Use the same environment exports as above:

```bash
node backup.mjs verify /home/cabc/private/cabc-minimal/backups/BACKUP_FILE
node backup.mjs restore \
  /home/cabc/private/cabc-minimal/backups/BACKUP_FILE \
  /home/cabc/private/cabc-minimal/restore-check.sqlite
```

The first command authenticates the encrypted file and checks SQLite integrity.
The second makes a private, unencrypted recovery copy at a **new** filename.
It refuses to overwrite an existing file or the configured live database.
Run this check after installation and periodically thereafter. Remove the test
copy when it is no longer needed; it contains private member data.

For real disaster recovery, stop the app and any backup job first, preserve the
current database and its WAL/SHM files, restore to a new private path, then point
`DB_PATH` at the recovered copy only after checking it. Restoring also rolls
back registrations, passwords and sessions to the snapshot's state.
The utility deliberately does not overwrite production or switch the app.
Regenerate the cron command after any DB_PATH or Node-runtime change.

## Operational limits

- **Same-server storage:** These copies help with accidental edits, not loss of
  the Dathorn account/server or an attacker with access to both the key and
  database. Off-server database copies remain a recommended separate step.
- **Recovery window:** Up to a week of changes can fall between scheduled
  backups. Extra manual runs consume retention slots, so 12 copies do not
  always represent 12 weeks.
- **Temporary plaintext:** The live database remains unencrypted. Private
  temporary snapshots are used during backup/verification and removed on
  normal completion, ordinary termination and timeout.
- **Hard termination:** A hard kill or machine crash can leave `.cabc-work-*`
  folders and `.backup.lock` in the private backup directory. Check the lock's
  `owner.json` and confirm no backup is running before removing only stale
  work/lock folders. Locks are not automatically broken. Never delete live
  `-wal`/`-shm` files as a cleanup shortcut.
- **Space and monitoring:** Keep room for existing backups plus temporary
  copies. Monitor failure output and backup freshness. Retention only manages
  timestamped `cabc-*.sqlite.enc` files; do not rename unrelated files to match.
- **Schema:** This format validates CABC schema version 1. Future schema changes
  must update and test backup validation explicitly.

## Completion checklist

- [ ] Upload `backup.mjs`.
- [ ] Run setup and securely store an offline recovery-key copy.
- [ ] Run the first backup and a restore check.
- [ ] Add the Sunday 03:00 cron entry and configure monitored output.
- [ ] Confirm a scheduled run actually produces a new verified backup.

The tests cover WAL consistency, encryption, tampering, wrong keys, restore
safety, overlap protection, retention, failure handling and schedule generation.
No Dathorn cron job has been installed from the development environment.
