# Team events: usage and Dathorn upgrade

If installing the latest source rather than the original team-events release,
also follow [Deactivate members](DEACTIVATE-MEMBERS.md) and run the subsequent
`member-status` migration before starting the current server.

Team events combine two registered pairs into one team of four. Either member
of either pair can form the team immediately; there are no invitations or
acceptance steps. Ordinary pair events continue to work as before.

## Member workflow

- **Register a pair:** Choose a partner through the dance card. Individuals can
  still register as looking for a partner, but cannot form a team until paired.
- **Form a team:** Under Choose another pair, select a complete available pair
  and press Form team. All four players are immediately assigned together.
- **View the field:** The dance card shows Registered teams with all four
  names, Pairs seeking teammates, and individuals Looking for a partner.
- **Leave a team:** Either member of either pair may use Leave team and confirm.
  The team dissolves; both partnerships and all four registrations are retained.
- **Cancel registration:** The cancelling member is removed; their partner
  remains registered as a single. If they were on a team, the team dissolves
  and the other pair remains paired and available.

The selector excludes incomplete pairs, the member's own pair, and any pair
already on a team. The server checks again at submission time. If another member
has taken a pair or changed a partnership, it refuses the stale request and the
calendar refreshes rather than assigning the wrong players.

Team actions are available only for today and future dates. Calendar export
continues to include one event per personal game registration, whether the
member is waiting for a partner, waiting for teammates or on a complete team.
Export event IDs and the cabc.club website links are unchanged.

## Administrator workflow

In Add date, choose Event type:

- **Pairs:** The default and the type assigned to all existing games.
- **Teams (two pairs):** Registers pairs first, then allows two pairs to combine.

Event type is fixed at creation in this release. Game names remain editable;
renaming a game does not affect registrations or teams. This release does not
add team names, captains, scoring, invitations, or automatic notifications.
Displayed team numbers are list positions, not permanent competition numbers.

## Upgrade the current Dathorn installation

This release needs an **explicit additive migration**. Do not run initialization,
replace the database, or use the earlier export-only upgrade instructions.
No build, npm dependency installation or SQLite native-addon compilation is needed.

Activate the existing application's Node environment in Dathorn's terminal.
Stop the Node application and avoid running member imports or other writers during
the upgrade. Keep its configured DB_PATH unchanged.

```bash
cd /home/cabc/src/cabc-minimal
export DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite

# Use the existing configured backup utility; stop if it fails.
node backup.mjs run
```

Keep the previous application files for rollback. Upload these six runtime and
migration files from the tested release, preserving their relative paths:

```text
team-schema.sql       new, application root
migrate.mjs           application root
db.mjs                application root
server.mjs            application root
public/app.js         public subdirectory
public/style.css      public subdirectory
```

README, HOSTING, package.json, tests and SHA256SUMS may also be updated for a
complete source checkout; they are not required to run this feature.
Keep public JavaScript/CSS files readable by the web server (normally 644).
Do not loosen permissions on the private database or backup directory.

Apply the migration using the same Node environment and private database:

```bash
node migrate.mjs team-events
```

Check that the printed Before and After counts match. The migration adds
`games.event_type`, defaulting to `pairs`, plus `team_members`, an index and
cancellation-protection triggers. It does not change passwords, sessions,
partnerships, game names or dates. It is safe to repeat; existing teams and
event types are preserved. Normal application startup never runs this migration.

For a very old minimal-site database without game names, run the existing
`node migrate.mjs game-names` migration first, then `team-events`.
This upgrade is not for the retired React/Express site's database.

Restart the Node application and hard-refresh the browser. Confirm that existing
games are still Pairs, the administrator Add date dialog offers Teams, and
member registration and calendar exports still work.

## Rollback and backups

The database keeps baseline `user_version=1` so the previous minimal-site
release can still open it. If rollback is necessary, restore the previous code
files, not the pre-upgrade database: restoring an old database would discard
registrations made since the backup.

Old releases do not display teams. Database triggers still dissolve a team
when an old release changes or deletes its underlying registration, preventing
orphaned team assignments. Existing team records otherwise remain available
when the new release is restored. Avoid scheduling further team events while
running an old version.

The configured SQLite backup process copies the new team table and triggers
along with the rest of the database. This repository update does not itself
upload files to Dathorn or migrate the live database.
