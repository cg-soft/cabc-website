# My Own Dates: use and Dathorn upgrade

The calendar's Show dropdown now includes **My Own Dates**, alongside All members
and the existing wildcard schedules. All members remains the default.

## Everyday use

- **My Own Dates:** Lists every current assignment for today and later, across
  all future months, ordered by date. The displayed calendar month does not
  restrict this list.
- **Assignment details:** Shows the game, date, Pacific start time, partner or
  solo status, and whether a team has formed for team events. Guest, standby and
  unavailable assignments are included with their proper labels.
- **Open a game:** Select an assignment to open its month and normal dance card.
  Show returns to All members so registration and cancellation controls work
  normally. Select My Own Dates again to return to the complete list.
- **Acting for:** Administrators see the selected member's assignments. Changing
  Acting for or choosing Return to myself preserves My Own Dates and updates the
  member shown. The signed-in account and document/account permissions do not
  change.
- **No assignments:** Displays “No assignments for today or later.” Cancellation,
  a new registration, or other successful calendar refresh updates the list.

Ordinary members receive only their own upcoming assignment rows in the new
response field. Administrators receive the rows needed for their existing
Acting for control. No member emails, passwords or new write permissions are
added.

## Upgrade an existing installation

This feature requires both the new browser code and the updated backend query.
It does not require a database migration, dependency installation, or changes to
SMTP, cron, DB_PATH, PUBLIC_DIR, remembered login or hosting routing.

From the matching source revision, upload:

| Repository file | Production destination |
| --- | --- |
| `server.mjs` | `/home/cabc/src/cabc-minimal/server.mjs` |
| `release.mjs` | `/home/cabc/src/cabc-minimal/release.mjs` |
| `package.json` | `/home/cabc/src/cabc-minimal/package.json` |
| `public/app.js` | `/home/cabc/public_html/app.js` |

Restart the managed Node application once, then fully reload the browser.
Preserve the existing public symlink, `.htaccess`, `config.js`, private
configuration, `node_modules` and all document viewer assets.
Do not enable PREVIEW_MODE on production.

About's initially collapsed Website version disclosure should report a running
backend matching Expected backend. If an older worker is still running, My Own
Dates explicitly reports that the server upgrade/restart is needed rather than
showing an incomplete month-only schedule.

## Acceptance checks

- Sign in as a member and confirm the Show choices include My Own Dates.
- Check a registration today, another future month, a partner, and any wildcard
  assignments. Past and cancelled entries must not appear.
- Open a listed date, change or cancel its registration, then return to My Own
  Dates and check the updated list.
- As administrator, switch Acting for and Return to myself while the list is
  open. Check that the member name and assignments update together.
- Check the empty state, existing wildcard views, desktop and phone layout,
  and normal calendar registration and team controls.

Source and preview testing are recorded in QA.md. Production installation and
actual iPhone Safari/home-screen acceptance remain owner-side checks.
