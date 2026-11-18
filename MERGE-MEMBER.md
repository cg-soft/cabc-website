# Merge duplicate member accounts

Use the server terminal when the same person has two active member accounts. Do not use this to combine accounts belonging to different people.

## Review first

Make a consistent SQLite backup with the existing backup workflow. Point the command at an absolute database path, preferably a restored private backup for the first run:

```sh
cd ~/src/cabc-minimal
export DB_PATH=/absolute/path/to/private/test-copy.sqlite
/opt/alt/alt-nodejs24/root/usr/bin/node manage.mjs merge-member --dry-run
```

Enter the email to keep first, then the duplicate email to retire. The command lists all affected dates (past and future), sessions to revoke, and queued notices to skip. It refuses placeholder or inactive accounts, conflicting bookings, inconsistent pair or team data, in-flight mail to the duplicate, and loss of the last active administrator. Resolve reported booking conflicts explicitly before retrying. The command does not choose a partner, availability status, or team for you.

## Apply and verify

Run the same command without `--dry-run` and type `MERGE` only after reviewing the plan. The kept account retains its password, role, notification preferences, and existing sessions. Identical unteamed bookings are combined; other non-conflicting bookings and their linked pairs and teams are transferred. The duplicate account and its email stay in the database for history, but the account is deactivated and all its sessions are revoked. Do not reactivate the duplicate after merging. Audit and document attribution are left intact. The command generates no emails and marks pending mail to the retired address as skipped.

Check the surviving account’s schedule, a transferred dance card, and that the duplicate is inactive. A failed merge rolls back automatically. After a successful merge, restoring an earlier backup would also revert unrelated changes since that backup; review those changes before any restore.

For a CLI-only install, copy `manage.mjs` and `merge-member.mjs` together to `~/src/cabc-minimal`. No website files, database migration, or Node restart are needed when the team and member-status schemas are already installed. Do not change `DB_PATH` in the running web application.
