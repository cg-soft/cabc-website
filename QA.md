# New minimal website verification

## Registered-game calendar export

All 96 automated tests pass on Node 22.23.2. New export tests cover current-day
and future registrations across months, paired and unpaired entries, exclusions,
administrator account scoping, anonymous/expired/logged-out access, ignored
member-ID query parameters, private download headers, no-games errors,
cancellations, record preservation, stable UIDs, unnamed games, Unicode folding,
escaped control characters and newline injection. The serializer is not served
as a public file. No schema or dependency changes were made.

An independent ICAL.js parser, installed only under /tmp for QA, successfully
parsed the calendar and round-tripped escaped Unicode text. Pacific 11:30 starts
on March 7/8 and October 31/November 1, 2026 converted to the expected UTC times
on either side of both daylight-saving transitions. No live Google account or
physical iPhone import was performed; client compatibility is based on standard
iCalendar output and independent parsing, not a claim of end-device testing.

Browser checks on a disposable copy of fictional preview data covered the
two-button home, About, invalid and valid login, administrator add-member,
add-date and rename, password dialog and actual password change, solo and paired
registration, across-month downloads, cancellation, empty exports, navigation
and logout. Simulated 503 and 401 export responses showed errors/re-enabled the
button or returned to login respectively. At 375px both member and administrator
layouts had no horizontal overflow and the download worked. Desktop and mobile
screenshots were inspected; no JavaScript page errors were recorded.

The existing private preview was updated and opened in a fresh browser context.
About, sign-in, calendar loading and authenticated .ics download worked through
the hosted API. The preview validator flagged pre-existing slideshow-counter
spacing; the homepage was visually reviewed and preserved rather than changed
outside the requested scope. The subsequent deployment bypassed that cosmetic
warning. Production Dathorn files and member records remain untouched.

## Operator promotion

All 83 automated tests pass on Node 22.23.2. The new management tests invoke
the actual CLI in subprocesses, simulating TTY capability for email prompts.
They verify missing-database refusal, noninteractive refusal, normalized email
lookup, unknown/blank/injection-shaped input rejection, role-only promotion,
unchanged already-admin success, and preservation of existing account fields,
password hashes, games, registrations and sessions.

After reopening the fixture database, the promoted member logs in with the
original password and can create a game through the administrator API.
Regression tests also verify initialization, password resets and usage output.
Only disposable fictional databases were changed. No production account was
promoted. Deployment requires only the updated manage.mjs on an otherwise
current installation; there is no UI, runtime-server or schema change.

## Private CSV member import

All 73 automated tests pass on Node 22.23.2, including eight enclosing tests.
Importer checks cover quoted fields, UTF-8/BOM/CRLF, reordered headers,
validation limits, duplicate emails, private-file permissions, symlink and
public-directory rejection, dry-run behavior, existing-account preservation,
explicit skip-existing behavior, and transactional rollback on insertion failure.
Missing, administrator-less and fictional preview databases are rejected.
Imported passwords are salted hashes; credentials are omitted from CLI output.
Integration tests verify login, password changes, retained registrations and
persistence after closing and reopening the database.

A separate disposable production-mode fixture was exercised through the actual
CLI: dry run preserved one administrator and one game; apply added one fictional
member without changing the game. That imported member signed in through the
browser and reached the calendar, dance card and Change password control without
administrator controls. No real CSV, production database or hosting setup was
changed. There are no runtime, UI or schema changes in this addition.

## Signed-in password changes

All 56 automated tests pass on Node 22.23.2, including six enclosing tests.
The new endpoint checks authentication and current credentials, validates both
new-password fields, limits attempts per account, and atomically updates the
hash and revokes all own sessions. Tests cover anonymous/expired sessions,
wrong current password without forced logout, input boundaries, mismatches,
reuse, targeting another account, both roles, session revocation, preservation
of partnerships, rollback on a forced database error, throttle expiry,
competing requests and persistence after reopening.

Browser tests use a disposable fictional member, not real club credentials.
Checked desktop/mobile form layout, masking, autocomplete, focus, mismatch and
wrong-password errors, cleared fields after cancellation, disabled cancellation
while saving, persistent success confirmation, old-password rejection, new
login, a second browser session being revoked, and retained partnerships.
No database schema change is required. The homepage still has two buttons.

## Original club favicon restored

Restored `public/favicon.png` unchanged from the previous site's logo-based
64×64 PNG, SHA-256
`d87a45eb99da8f14e7a2160a94f53e6d54b805710771b85e2f6097b661f97201`.
The shared HTML shell links it and the Node static allowlist serves it as
image/png. GET and HEAD tests pass; all 45 automated tests pass.

Browser checks confirmed successful PNG loading and decoding at 64×64, About,
invalid and preview logins, calendar names/gap navigation, pair/solo registration,
cancellation, past-date restrictions, admin name save, duplicate member/date
errors, mobile layout, logout and reload. No browser exceptions were observed.
The homepage layout and database schema are unchanged by the favicon change.

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
