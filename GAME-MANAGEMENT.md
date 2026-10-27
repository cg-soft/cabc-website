# Edit and delete games: usage and Dathorn upgrade

Administrators can edit and delete games scheduled for today or later.
Ordinary members cannot manage games, and past games stay read-only.
Production deployment is the owner's manual step; nothing here uploads to
Dathorn or modifies its database.

## Edit a game

- Select a playing date in the calendar. If viewing a wildcard schedule, set
  Show to All members first.
- Choose Edit game on the dance card, beneath its name and start time.
- Change the optional name, date or Pacific start time, then Save changes.
  Cancel or Close leaves the game unchanged.
- The game keeps its ID, registrations, partnerships and teams. The calendar
  follows a rescheduled game to its new month. A name can be cleared.
- Dates must be valid and today or later. A date already used by another game
  is rejected. Names are limited to 80 characters; time must be valid.
- Pairs/Teams event type remains fixed, consistent with the original creation
  rules. To change event type, deliberately create a replacement game and
  arrange new registrations; existing registrations are not transferred.

Tell registered players about schedule changes yourself. No email or other
notification is sent. Exported `.ics` files are snapshots, not subscriptions:
previously imported calendar items do not update or disappear automatically.
Rescheduling changes the date component of the existing export UID format, so
an earlier imported item may need to be removed manually before reimporting.

## Delete a game

- Select the game and choose Delete game on its dance card.
- Review its exact name, date, start time, event type, number of registered
  real members and number of teams. Shared placeholders are not counted as
  registered real members; their assignments are removed with the game.
- Cancel is focused by default. Choosing Cancel, Close or Escape before
  submission changes nothing.
- Explicitly choose Delete game in the confirmation dialog to permanently
  remove that game, all its registrations and all its teams in one transaction.
  Other games, member accounts and sessions are unchanged.
- If the last game in a month is deleted, the calendar falls back to an
  available upcoming month. With no upcoming games, it shows No upcoming games.
- Deletion cannot be undone from the website. Restore/recovery from a private
  backup is an owner-controlled operation, not an automatic feature.

## Concurrent changes and failures

Both dialogs fetch a fresh administrator-only review. Save and delete require
its revision, computed from the game, registrations, teams and current club
date, checked again under a write transaction. If anything in that review
changes, the operation is refused without applying it. Close and reopen the
dialog to review the latest game before trying again.

Submit, Close, Cancel and Escape are guarded during save/delete to prevent
duplicate submissions or hiding an operation in flight. Validation errors stay
in the dialog. A database failure rolls back the whole operation. The older
name-only API remains available for compatibility, but also invalidates an
open review when it changes the game.

## Dathorn upgrade

This is an incremental upgrade from the wildcard release, with its existing
game-name, team-event and member-status migrations already installed.

- Back up the private live database using the established backup procedure.
- Stop the Node application/writers while replacing the runtime files.
- Upload these three files from the same revision:
  - `server.mjs`
  - `public/app.js`
  - `public/style.css`
- Restart the application and refresh the browser.
- Confirm the new controls appear for an administrator, not an ordinary
  member. Test on a deliberately created fictional game, never a real game
  with real registrations.

No migration, initialization, build or dependency installation is needed.
Do not upload a preview database or preview-only `config.js`. The earlier
Add date displayed-month default is included in `public/app.js`.

## Rollback

Stop the application, restore the prior wildcard-compatible server/client/style
files together, then restart. No schema changes are introduced, so older
wildcard-compatible versions can read surviving games and rescheduled dates.
Rolling back code does not undo edits or recover deleted games or registrations.
Recovery from backup is a separate, explicitly authorized owner operation.
Going further back than the wildcard release also requires the precautions
in [WILDCARDS.md](WILDCARDS.md).
