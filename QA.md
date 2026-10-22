# New minimal website verification

## Game names and upcoming-month navigation

All 44 automated tests pass on Node 22.23.2, including five enclosing tests.
The explicit migration preserves all existing member, game, partnership and
session records and can be repeated safely. On the fictional preview database,
counts stayed at 8 members, 9 games, 35 entries and 1 session before/after the
migration. A prior-release database reader successfully opened the upgraded
database. Backup recovery now explicitly verifies the saved game name.

Local browser checks verified optional names on creation; edit/clear names;
names in desktop cells, mobile rows and dance cards; 80-character wrapping;
literal display of HTML-looking names; unchanged pairs after renaming; initial
selection of December when October has no future games; December-to-March gap
navigation; endpoint-disabled controls; Upcoming; a global empty schedule;
and error/retry without a false empty state.

Rechecked real member creation and login, duplicate member/date errors, invalid
login, paired/solo registration, cancellation, past-game read-only controls,
logout/reload, About, the two-button home and slideshow movement. No browser
exceptions or horizontal overflow at 375, 768, 900 or 1440px. Reviewed screenshots
of desktop, mobile, long-name and global-empty states. Existing Dathorn data and
hosting settings were not modified; production migration is an operator step.

## Weekly encrypted backups

Added a separate maintenance utility, not a website feature or schema change.
The complete automated suite passes on Node 22.23.2: 32 tests including three
enclosing tests. Backup checks cover setup idempotency, private permissions,
committed WAL data while a writer remains open, exclusion of uncommitted writes,
authenticated encryption, tamper/wrong-key detection, restored member/date/pair
records, no-overwrite restore, lock refusal, retention of 12 copies, preservation
of unrelated files, failure cleanup, missing-key/database safeguards, safe
paths, standalone CLI commands, and execution of the generated cron command
with a minimal environment from a different working directory.

The existing application/UI and database schema files remain unchanged.
Real Dathorn installation, offline key custody, monitoring and the first
scheduled run must be completed by the hosting-account operator.

The initial implementation and hosting handoff left the original application,
repository and production database unchanged. At the owner's subsequent request,
this implementation replaces the GitHub repository with a fresh root commit.
The Dathorn application and production database are still unchanged by this work.

## Hosting handoff

The hosting entry point, `app.cjs`, refuses preview mode and preview databases,
supports direct startup, and implements Passenger's explicit listener contract.
The Passenger loader path was simulated, not tested on a live Passenger host.
All 18 automated tests passed on Node 22.23.2 (16 leaf checks plus two enclosing
tests). A disposable database was initialized using the actual interactive
`manage.mjs init` prompts in a terminal.

A production-mode browser check through `app.cjs` verified the two-button home,
About, absence of preview shortcuts, real generated-password administrator login,
initial empty calendar, adding a date and member, real member login, pairing and
cancellation on mobile. No browser exceptions occurred. Public assets and the
database schema are unchanged from the reviewed calendar-layout version.

The downloadable archive contains no database, live accounts, generated
passwords, `.env`, preview deployment, node_modules, or version-control history.
Test code and the optional preview-seeding command contain fictional fixtures,
but no fixture database is shipped. Actual Dathorn routing, host runtime,
certificate setup and backup operations remain unverified.

## Calendar layout revision

The calendar now has a separate month title and playing-date count, bordered
navigation controls, a circled current date, and distinct selected-date styling.
Desktop cells show pair counts even when the member is registered; a checkmark
indicates their registration. The dance card is a bordered panel with a date
badge and separate registration and pair-list sections.

At 640px and below, the month grid becomes a playing-date list with readable
times, pair counts and registration/partner status. Selecting a date scrolls
to and focuses its dance card. No database or backend changes were needed.

Rechecked login failure, member/admin preview access, pair registration,
cancellation with retained partner, solo registration, empty and past dates,
previous/next/Today, both admin dialogs and duplicate-input errors, logout,
reload, About, homepage two-button count and slideshow advancement.
Successful admin creation remains covered by the unchanged isolated API tests.
All 12 automated tests passed. Desktop/mobile/desktop resizing at 375, 768,
900 and 1440px retained the selected date without horizontal overflow.
A short 620px desktop viewport scrolls normally. No browser exceptions observed.

## Automated checks

Node.js 22.23.2 syntax checks passed for the browser and server JavaScript.
The isolated API suite passed all 12 tests, including the enclosing suite:

- Explicit initialization and private-path restrictions.
- No production preview-login bypass.
- Real password login, hidden credentials, protected API access.
- Member/admin authorization, member creation, date validation.
- Solo and reciprocal pair registration.
- Cancellation that preserves the former partner's solo registration.
- Conflicting concurrent requests cannot double-book a partner.
- Past-date write rejection and invalid input handling.
- Logout, session expiry, login throttling.
- Persistence after closing and reopening SQLite.

## Browser checks

Desktop and 375px views were inspected. The homepage has exactly About and
Login buttons; About is an intentional placeholder. Checked invalid login,
sample member access, pair/solo registration and cancellation, availability
filtering, past games, empty months, and month navigation.

An administrator created a synthetic future playing date and member through the
actual dialogs. That member signed in with the new password and had no admin
controls. The synthetic test account and date were then removed from the private
preview database; no production data was used.

After adjusting desktop calendar row heights, the month and legend fit the
900px desktop viewport. No horizontal overflow or JavaScript exceptions were
observed in the tested views. Mobile calendars stack above the dance card.
Reload intentionally requires signing in again.

## Deployment boundary

The deployed preview was reopened in a fresh browser context. Its homepage
still has exactly two buttons, and authenticated calendar reads, pair
registration, cancellation, and mobile date-to-dance-card navigation passed.
Read/write/cancellation also passed inside a sandboxed iframe with an opaque
origin and no browser-storage access. Automatic slideshow advancement,
keyboard resume, and reduced-motion suppression were verified.

The preview uses a separate copy of public assets with a preview-only API base.
The production source remains same-origin and requires no build step.
Native built-in SQLite is experimental in the tested Node 22 version; Dathorn
compatibility and production routing are not verified by these local tests.
