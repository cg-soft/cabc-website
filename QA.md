# New minimal website verification

## Align Show and month navigation

All 177 tests passed on Node 22.23.2 and 24.20.0. A new stylesheet regression
test guards the Show label's zero bottom margin, matching 44px selector/button
heights, and header wrapping with a readable minimum month-title width.
Runtime changes are CSS-only; no server, database or JavaScript changes.

Before editing, browser measurements showed the Show label inheriting a 20px
bottom margin: its 40px dropdown started at y=267.578, Upcoming at y=275.578,
and the arrows at y=274.969 with a 45.203px height. The scoped fix removes the
margin and normalizes all four controls to 44px. Header wrapping also prevents
the month title shrinking to 13px wide just above the mobile breakpoint.

After the fix, exact top/bottom-edge and height assertions passed at 481px,
640px, 768px, 900px, 1000px and 1440px. At 375px and 480px the existing
full-width Show row stays above a consistently aligned button row. All eight
widths had no horizontal document overflow and a month title at least 160px
wide. Resizing the same session back to 1440px preserved alignment. Desktop,
375px mobile and the 481px boundary screenshots were visually inspected.

Browser regression checks covered all three wildcard views and All members,
keyboard selection, month navigation/Upcoming, Add date's November 1 default,
Edit/Delete game review, Add member/Deactivate member/Change password dialogs,
calendar export, both fictional preview roles, Home's two buttons and About.
No JavaScript page exceptions were observed. No seeded registrations or teams
were changed by this CSS QA; account/game mutation coverage remains in the
isolated automated tests.

After redeployment, a fresh hosted browser context signed in as the fictional
administrator through the preview API. The selector and all three buttons
measured y=272.71875 to y=316.71875, each exactly 44px tall. Hosted desktop and
375px mobile screenshots were inspected. Standby schedule data loaded through
the API, navigating to November worked, and Add date still defaulted to
November 1. No horizontal overflow or JavaScript page exceptions were found.
Verification used the deployment tool's direct hosted URL; the Perplexity
wrapper requires owner sign-in.

## Edit and delete games

All 176 automated tests passed on Node 22.23.2 and 24.20.0. The new isolated
management suite covers authorization for GET/PATCH/DELETE, expired sessions,
review counts, cross-month/year rescheduling with IDs/entries/guest
assignments/teams preserved, clearing names, invalid dates/times/names,
duplicate dates, fixed event type, strict confirmation, missing/stale
revisions, changed registrations/teams/details, concurrent edits, past/missing
games, transaction rollback, targeted deletion, month fallback and the global
empty calendar after the last upcoming game. Legacy name-only updates remain
compatible. No schema or startup migration changes were introduced.

Browser QA used only fictional preview accounts. Created a synthetic Teams
game on December 10, 2026; two real members each paired with the same guest
placeholder, then formed one team. Edit prefilled the stored fields, moved
the game to January 14, 2027, changed its name and start time, selected January
in the calendar, and retained both guest pairs and their complete team.
Names containing markup characters rendered as literal text.

Delete review showed two registered members and one team, with Cancel
initially focused. Cancelling the dialog left the game intact. A member's
concurrent cancellation changed the review; attempting the stale deletion
showed the conflict message and removed nothing. Reopening showed one member
and zero teams. Re-registered that fictional player and re-formed the team;
the final fresh review again showed two members/one team, and explicit
deletion removed the game and dependencies and selected October.

An unrelated-data snapshot before deletion and the complete snapshot after
deletion had identical SHA256 hashes. Final preview row counts returned to
15 games, 53 entries, 7 team-membership rows, 16 members and 15 sessions;
foreign_key_check found no errors. These counts describe that local QA run,
not the production database.

Duplicate-date edits showed an inline error. A deliberately delayed save
disabled submit/close controls and blocked Escape, then completed when the
request resumed. Ordinary members had no management controls and past games
had none for administrators. Desktop 1440px and mobile 375px were inspected:
no horizontal overflow; long edit dialogs scroll internally, with Save and
Cancel reachable. Native date/time controls remained editable.

Regression checks included Add date's November 1 default, administrator
Add member/Deactivate member/Change password dialogs, wildcard schedule and
cross-month jump, team formation, registration and cancellation. No browser
JavaScript page exceptions were observed in these checks. Expected HTTP 409
responses occurred for deliberately conflicting reviews/dates.

Hosted verification used a fresh browser context on the deployment tool's
direct hosted URL, with the running sandbox backend on port 5005. The first
attempt exposed the preview still reaching the previous backend process;
starting the new server version on the existing preview port corrected that.
The hosted administrator form loaded stored fields. Created a fictional
February game, edited its name/date/time into March, and explicitly deleted
it through the hosted proxy. March remained selected because an unrelated
March 8 game still existed. The success toast confirmed deletion, the
calendar reloaded real API data, and cabc-my-games.ics downloaded successfully.
Hosted mobile deletion was visually inspected without horizontal overflow;
no JavaScript page exceptions were observed. The temporary hosted QA game
was removed. The Perplexity wrapper requires owner sign-in; interaction QA
used the deployment tool's direct hosted URL.

## Add date defaults to the displayed month

All 160 tests passed on Node 22.23.2 and 24.20.0. Eight new browser-script
regression tests exercise the real Add date click handler with a minimal DOM:
future month, current month, year boundary, leap day, first day, unloaded/empty
calendar, stale past month, and reopening after navigation. The minimum stays
today in all cases; no server or database changes were made.

Before editing, reproduced November 2026 opening the form with October 24.
After editing, the real browser showed November 1 in November, October 24 in
October (the preview's fixed today), and November 1 again after closing an
unsaved edit and reopening. The field remained editable, Teams selectable, and
11:30 unchanged. Returning with Upcoming restored the current-month default.
Desktop 1440px and mobile 375px dialogs were visually inspected with no
horizontal overflow; resizing retained the dialog.

Regression browser checks covered Home's two buttons, About, both preview
roles, month navigation, the guest schedule selector, Add member/Deactivate
member/Change password dialogs, team-card display, guest registration and
cancellation on November 2, and a successful cabc-my-games.ics download.
The temporary guest registration was cancelled through the UI. No JavaScript
page errors were observed. Account changes, team creation and game creation
are covered by the isolated automated suite, not repeated as writes in this
preview run. Only fictional preview accounts were used.

After redeployment, a fresh browser context loaded the hosted preview, signed
in as the fictional administrator through the proxied API, and loaded both
October and November calendars. The dialog showed October 24 in October and
November 1 in November. Hosted desktop 1440px and mobile 375px screenshots
were inspected; the dialog fit without horizontal overflow or page errors.
The Perplexity wrapper itself requires owner sign-in; hosted interaction
verification used the deployment tool's direct hosted URL.

## Wildcard placeholder members

All 152 automated tests pass on Node 22.23.2 and Node 24.20.0, including the
new wildcard suite. Placeholder accounts named exactly `-Unavailable-`,
`-Standby-` and `-Guest-` cannot sign in, and stale sessions are rejected with
401. Registering with a placeholder stores one one-directional row, so several
members overbooked the same placeholder in one game while real members stayed
exclusive (a taken real partner is refused with 409). Legacy reciprocal
placeholder-owned rows are excluded from calendar reads and cleaned up on
registration and cancellation; a cancelled assignment removed only the
cancelling member's row. Guest pairs complete teams, including two guest pairs
sharing one team, and only real member IDs are stored on teams; standby and
unavailable pairs are refused with 409. Placeholder deactivation review counts
future assignments and affected games, and applying it clears assignments while
affected members remain registered as singles and past records are preserved.
Cross-month schedules are returned while viewing an earlier month.

Browser QA used the fictional preview database only. The Show selector listed
all three placeholders beside All members for both member and administrator
views. Selecting `-Guest-` replaced the dance card with its schedule (October
26 with two assignments, October 29 team event, November 12), and the cross-
month jump button switched the calendar to November 2026 with that game
selected while keeping the Show selection. Calendar cells and agenda entries
annotated per-game assignment counts. A member registered with `-Guest-` on
November 2 and saw the "You're playing with a guest" status and toast, the
dance card listed the pair and grouped Jordan Chan under Standby and Sam Liu
under Unavailable, and cancelling removed only that member's assignment with
no partner sentence in the confirmation. A team was formed between a real pair
and a guest pair in the Thursday Teams game. The placeholder sign-in form was
refused with "This placeholder account cannot sign in." The administrator
deactivation review of `-Guest-` reported removing four future assignments
across three games and was cancelled without applying.

Visual QA covered 1440px desktop and 375px mobile. A mobile overflow where the
Show row pushed the month navigation past the card edge was found and fixed by
letting the controls wrap at up to 480px; re-measurement confirmed the controls
fit inside the card with no horizontal scrolling. The boundary was checked at
both 480px and 481px with no overflow or clipping at either width, and focused
screenshots confirmed no clipped cell text. No JavaScript page errors were
recorded; the only console entries were deliberate 401 responses from the
placeholder sign-in test and unauthenticated verification fetches.

The deployed preview was verified against its hosted URL, not just its files:
the preview configuration now targets the sandbox backend through the deploy
proxy, preview sign-in works, and the Show selector, `-Guest-` schedule and
cross-month jump were exercised on the hosted application. The two hosted test
registrations were cancelled afterwards, restoring the fictional preview
database to its seeded state.

Production hosting and accounts have not been modified. WILDCARDS.md documents
the four-file upload, placeholder creation with manage.mjs and the lack of any
migration.

## Administrator member deactivation

All 144 automated tests pass on Node 22.23.2 and Node 24.20.0. The explicit,
additive member-status migration preserves all original account fields, game
records, entries, sessions and teams; members default to active. Missing and
unsupported databases are refused, incompatible schema additions roll back,
and repeated migration retains inactive status and audit fields. Startup
requires the migration but never runs it automatically.

API tests verify admin-only list/review/action access, explicit confirmation,
binding the review to the correct member and current impact, stale-registration
refusal, transactional rollback, today/future cancellation, past-team and
partnership preservation, former-partner handling, all-session revocation,
generic inactive-login rejection, preview-login blocking and unavailable-partner
rejection. Inactive accounts cannot regain access through password reset,
promotion, CSV import or older session/registration SQL. The last active admin
is protected at both API and database levels; competing deactivations leave
one administrator active. Self-deactivation signs out only when another active
administrator remains. Backup/reopen retains statuses and historical teams.

Browser QA used fictional copies only. Reviewed target identity and impact,
cancelled without changes, then added a registration from a second session:
the stale confirmation was refused and refreshed from two to three affected
registrations. Confirming the refreshed review deactivated only that test
account, removed its three future/current registrations and one future team,
retained the other pair and past team, removed it from partner options, and
blocked the existing session and subsequent password login.

Inactive and last-admin options were verified disabled. A second fictional
administrator completed the self-deactivation flow and saw the sign-out notice.
A simulated 503 restored the review and usable cancellation controls. Desktop
and mobile review screenshots were inspected; 320, 375, 768 and 1440px admin
layouts had no horizontal overflow and retained the floating logo.

Regression browser checks covered the home/About/login routes, member/admin
separation, pair and team registration/cancellation, date navigation, calendar
export, rename/save and the administrator/password dialogs. No JavaScript page
errors were recorded. The confirmation defaults keyboard focus to Cancel;
the final request disables dismissal while processing.

Production hosting and accounts have not been modified. DEACTIVATE-MEMBERS.md
documents the eight-file upload, backup, explicit migration, restart, audit
fields, rollback limitations and lack of permanent deletion/reactivation UI.

## Transparent floating club logo

All 120 automated tests pass on Node 22.23.2. The transparent PNG from the
separate logo project was copied byte-for-byte, not redrawn or recolored:
548 × 500 RGBA, transparent exterior, opaque red fill and white artwork.
Both the source and public asset have SHA-256
`ad4922baa11d5ded779ad28754f38187024ce927eb6156e5f9192955a013e373`.
The added HTTP test verifies one persistent image before the route container,
accessible alternative text, PNG GET/HEAD handling, RGBA format, exact served
bytes and refusal of POST. Existing favicon checks still pass.

Browser checks verified Home, About, Login, member and administrator Calendar,
scrolling and dialog layering. Viewports 320, 375, 768 and 1440px showed exactly
one fixed logo, no horizontal overflow and no logo/navigation overlap.
The homepage retains exactly About and Login buttons. Mobile uses the logo
instead of a duplicate text wordmark; sticky headers reserve a logo lane and
scroll padding protects keyboard-focused content.

Regression interactions exercised team formation/dissolution, pair registration
and cancellation, solo registration, calendar navigation/export, invalid login,
preview member/admin login, password-error handling, logout and administrator
date/member/rename dialogs. No JavaScript page errors were recorded. Desktop and
mobile screenshots were visually reviewed. Production hosting and account data
were not changed. Only server.mjs plus public/index.html, public/style.css and
public/club-logo.png are needed on an otherwise current installation.

## Immediate team events

All 119 automated tests pass on both Node 22.23.2 and Node 24.20.0. The additive team-events migration
preserves baseline members, password hashes, sessions, games and pair entries;
existing dates default to pairs. Missing databases and unsupported schemas are
refused, partial failures roll back, and repeated migration preserves existing
teams. New server startup explicitly refuses an unmigrated database. Fresh
initialization installs the new schema; normal startup does not.

API checks cover admin-only type selection, invalid types, default pair events,
anonymous/expired access, complete reciprocal partnerships, either partner
initiating, duplicate membership prevention, stale partner selections, competing
requests, unauthorized dissolution, whole-transaction rollback, cancellation,
closed/missing dates, separate dates and months, migration repetition with real
fixture teams, SQLite backup/reopening and integrity checks. Existing calendar
export keeps one event per registration and retains its URL and legacy UID.
Simulated old-release UPDATE/DELETE statements exercise the database triggers
that dissolve teams when underlying partnerships change.

Browser QA used only fictional preview databases. Checked administrator type
selection, first-pair/no-other-pairs state, complete available-pair filtering,
immediate team formation, all four names, either partner leaving, and all pairs
being preserved. Two browser sessions reproduced a stale selection: the other
pair formed a team elsewhere, the stale request was rejected, and the selector
refreshed to remove both occupied pairs. Cancellation showed its consequence
before submission, dissolved the team, retained the other pair and listed the
former partner as a single.

Regression browser checks covered the two-button homepage, About, invalid and
valid login, admin member/date creation and renaming, actual password change
and re-login, pair registration/cancellation, solo registration, month navigation,
logout and calendar export. Desktop and 375px screenshots were inspected;
mobile member/admin views had no horizontal overflow. The team selector and
event-type selector have explicit accessible names. No JavaScript page errors
were recorded.

The existing private preview was updated and opened in a fresh browser context.
The deployed interface formed and dissolved a team through its hosted API,
showed both registered teams, restricted the dropdown to the remaining eligible
pair, downloaded the calendar file, and fit the mobile viewport. Demo state was
left with one complete fictional team and two available pairs. No Dathorn files,
live accounts or production database were changed; TEAM-EVENTS.md contains the
explicit six-file upload, backup, migration, restart and rollback instructions.

## Export link domain correction

All 97 automated tests pass on Node 22.23.2. Export URL properties now use
https://cabc.club/#calendar, while the exact legacy
`cabc-game-{id}-{date}@bridge.cabc.club` event identifiers are preserved.
A regression test pins a complete historical UID and the new URL; the
authenticated export integration test checks both as well.

A direct comparison against the previous committed serializer, using identical
games and timestamps, confirms the output is byte-for-byte identical except
for the URL properties. No UI, registration, schema or dependency behavior
changed. Install the correction by replacing only icalendar.mjs and restarting
the Node application. Production hosting was not modified by this commit.

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
