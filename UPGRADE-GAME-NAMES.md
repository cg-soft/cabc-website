# Upgrade: game names and upcoming-month navigation

This release adds optional game names, editable by administrators, and skips
months without upcoming games. It requires one explicit additive migration for
an existing minimal-site database. No Dathorn files or data were modified by
preparing this release.

## Changed behavior

- **Names:** Add date accepts an optional name of up to 80 characters. Edit name
  on an upcoming game's dance card changes or clears it without changing its
  date, time or registered partnerships. Names appear in desktop cells, mobile
  playing-date rows, accessible labels and the dance card.
- **Initial month:** Opening the calendar selects the earliest month containing
  a scheduled game dated today or later, using the club's Pacific date.
  A remaining game this month takes precedence over later months.
- **Navigation:** Previous/next move only between months containing upcoming
  scheduled games. Empty months and past-only months are skipped, including
  across years. The Upcoming button returns to the earliest available month.
  Past games within a displayed current month remain readable.
- **Empty state:** No upcoming games appears only if no scheduled games remain
  today or later. A game with no member registrations is still a scheduled game
  and is displayed. Network errors are not presented as an empty schedule.

## Upgrade the existing Dathorn installation

Use `/home/cabc/src/cabc-minimal` as the application directory and
`/home/cabc/private/cabc-minimal/club.sqlite` as DB_PATH.

1. Make a verified backup before changing files or data. If the backup utility
   has been configured, activate Dathorn's Node environment and run:

   ```bash
   cd /home/cabc/src/cabc-minimal
   export DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite
   node backup.mjs run
   ```

   If backups are not configured yet, follow `BACKUPS.md` first or arrange a
   consistent host backup while all writers are stopped. Do not simply copy the
   live main SQLite file while it is being written.

2. Stop the web application during the upgrade. Pause any configured backup job
   for the maintenance window so it cannot overlap the migration.

3. Upload the matching new runtime files:

   ```text
   db.mjs
   server.mjs
   migrate.mjs
   schema.sql
   public/app.js
   public/style.css
   ```

   `package.json` and documentation can also be updated. No build or dependency
   installation is needed. Do not upload a development database or replace the
   `private` folder. Existing `app.cjs`, `manage.mjs`, public images, homepage
   HTML and `backup.mjs` do not need changes for this upgrade.

4. In the activated Node environment, run:

   ```bash
   cd /home/cabc/src/cabc-minimal
   export DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite
   node migrate.mjs game-names
   ```

   It prints counts for members, games, entries and sessions before and after.
   These counts must be unchanged. Do not use `manage.mjs init` to upgrade.
   Re-running this migration is safe and does not clear existing game names.

5. Restart through Dathorn, refresh the browser, and sign in. Resume the backup
   job if it was previously enabled. Confirm:

   - An existing game is still present with its registered pairs.
   - Edit name saves and displays on desktop and phone.
   - Previous/next skip any gaps in your schedule.
   - A named backup can be recovered to a separate private test file.

If startup reports “Game-name migration required,” verify that the terminal and
application settings use the same DB_PATH, then run the migration on the correct
database. Do not initialize a replacement database.

## Compatibility and rollback

The migration adds `games.name TEXT NOT NULL DEFAULT ''` and records
`migration:001-game-names` in metadata. Existing rows are not rewritten or
removed. SQLite `user_version` remains at baseline **1** because earlier releases
check that value strictly; this optional additive feature is identified by its
column and migration record instead.

An older server can still use the upgraded database; it will simply not display
names. An older backup utility also retains the new column. Before rolling back
source files, stop the app and restore the matching old frontend/backend files
together. Leave the new column in place; do not drop it or restore an old
database just to undo this feature.

New installations receive the column from `schema.sql` during normal explicit
initialization and do not need a separate migration. Restoring an older,
pre-feature backup requires the explicit migration before starting the new
server. This upgrade does not migrate the superseded React website's database.
