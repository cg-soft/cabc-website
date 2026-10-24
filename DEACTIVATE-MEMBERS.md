# Deactivate members: usage and Dathorn upgrade

Administrators can deactivate an account without deleting the member or their
historical game records. Members cannot view the management list or use its API.
This release does not add permanent deletion or a reactivation button.

## Administrator workflow

1. Sign in as an administrator and choose **Deactivate member** above the calendar.
2. Select the account by name and email. Inactive accounts and the last active
   administrator are disabled in the selector.
3. Choose **Review deactivation**. Review the identity and the number of
   registrations and teams affected.
4. Choose **Deactivate member** in the confirmation dialog, or Cancel to leave
   everything unchanged.

Reviewing an account does not modify it. The final confirmation applies only to
the account and registrations reviewed. If the member signs up again, changes
partnerships or teams, or another administrator changes the account in the
meantime, the action is refused and the review is refreshed. The administrator
must review the updated effects and confirm again.

Once the final request is being processed, the Cancel and Close controls are
disabled until it finishes. If a request fails, the review is refreshed or an
error is shown rather than claiming success.

## What deactivation changes

- **Access:** All sessions are revoked and sign-in is blocked. An already-open
  page may remain visible until the member's next request, which returns them
  to the login screen.
- **Availability:** The member is excluded from available-partner selection.
  Stale selections are also rejected by the server.
- **Registrations:** Their registrations dated today or later are cancelled.
  The cutoff is the club's Pacific calendar date, not each game's start time.
- **Partners and teams:** Former partners remain registered as singles.
  Affected future teams dissolve; the other pair remains registered together.
- **History:** Registrations and teams before today retain the member's name
  and original partnerships. The account, email, role and password hash remain.
- **Audit fields:** The database records the deactivation time in UTC and the
  administrator's member ID.

The last active administrator cannot be deactivated, even if inactive
administrator accounts exist. An administrator may deactivate their own
account only when another active administrator remains. The confirmation warns
that this will sign them out.

Repeating a successful deactivation makes no further changes. Password resets,
promotion and member CSV imports do not reactivate an inactive account. Its
email remains reserved to that account; importing that email is rejected or
skipped unchanged with `--skip-existing`.

## Dathorn upgrade

This release requires an **explicit member-status migration**. Do not run
initialization, replace the live database, or upload a fictional preview database.
There are no new npm dependencies, build steps or native SQLite compilation.

Activate the application's Node environment, stop the application and pause
other account/registration writers. Then make a backup using the existing
configured backup utility:

```bash
cd /home/cabc/src/cabc-minimal
export DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite
node backup.mjs run
```

Stop if the backup fails. Preserve the current application files for rollback.
On an installation that already has team events, upload these eight files from
the tested release, keeping their relative paths:

```text
member-status-schema.sql    new
db.mjs
migrate.mjs
server.mjs
manage.mjs
import-members.mjs
public/app.js
public/style.css
```

Update package.json, documentation, tests and SHA256SUMS too if maintaining a
full checkout; they are not needed to invoke the migration directly.
Keep public files web-readable (normally 644), without changing private-folder
or database permissions.

Run:

```bash
node migrate.mjs member-status
```

Before and After counts should match for members, games, entries, sessions and
team membership. Existing members default to active. The migration adds
`active`, `deactivated_at`, `deactivated_by` and protection triggers; it does
not deactivate anyone or remove any registration.

If this database predates team events, first install the corresponding files
and run `node migrate.mjs team-events`. If it also lacks game names, run
`node migrate.mjs game-names` before that. Normal startup does not migrate
databases; the current server refuses to start without the required schema.

Restart the application and hard-refresh the browser. Confirm that the option
appears for administrators but not ordinary members. You can open the review
and Cancel to verify the flow without deactivating anyone.

## Backup and rollback

The migration is additive and safe to repeat. It preserves baseline
`user_version=1`, account identifiers and historical data. Repeating it does
not reactivate inactive accounts or change their audit fields. Full SQLite
backups include the new columns and triggers.

If rolling back code, keep the migrated database rather than restoring an old
backup over newer registrations. Database triggers prevent old code from
creating sessions or registrations for inactive members and protect the last
active administrator. An older interface may still list inactive members and
show generic errors for blocked actions; use the current version for correct
status display and management.

The repository update and private preview do not upload files to Dathorn,
modify its environment, migrate its database or deactivate any real member.
