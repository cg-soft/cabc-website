# Main flows and calendar layout checks

## Operator promotion
- Run `node manage.mjs promote` in an interactive terminal with the live `DB_PATH`.
- Enter an existing member's email; whitespace and case are normalized.
- Change only that member's role to admin, preserving password, sessions and registrations.
- Report an already-admin account without changes; reject an unknown email.
- Never initialize a missing database or migrate an existing one.
- Member logs out and back in to refresh the administrator controls.

## Existing flows to preserve
- Home: exactly About and Login buttons; slideshow advances and respects reduced motion.
- About: About placeholder, Home and Login return correctly.
- Login: invalid credentials show an error; member/admin preview login opens the calendar.
- Calendar: previous/next skip to months with upcoming games; Upcoming returns to the earliest such month. No empty month is rendered; past dates within a displayed current month remain readable.
- Dance card: select a date, see all pairs, select an available partner, register both, or register solo.
- Cancellation: confirm cancellation; own entry is removed and partner remains looking.
- Admin: same calendar, Add date and Add member dialogs; close buttons and validation work.
- Log out invalidates session; reload requires login.

## Requested layout improvement
- Desktop: readable month navigation, distinct playing/selected/today states, pair counts and own registration both visible.
- Dance card: bordered panel, clear selected-date header, registration visually separated from pair list.
- At 640px and below: show the month's playing dates as a list instead of seven compressed columns, with readable times, pair counts and registration status.
- Mobile selection scrolls to the matching dance card; desktop keeps the side-by-side layout.
- Resize desktop to mobile and back while signed in; retain selected month and date.
- Check 375px, 768px, 1440px, and a short desktop viewport for overflow.
- Recheck registration/cancellation after deployment through the hosted API.
- Do not change home, about, authentication, database, or partnership rules.

## Hosting package checks
- Preserve all public source bytes from the reviewed calendar version.
- Deliver source, not the preview deployment folder or database.
- Production startup serves the same application with preview access disabled.
- Missing database fails clearly; initialization remains an explicit operator step.
- Real production-mode login and empty-calendar API work through app.cjs.
- Test Passenger's startup contract with a simulation; label actual host integration unverified.
- Extract the ZIP and rerun API and startup tests from its contents.

## Weekly backup checks
- Keep application/UI behavior and schema unchanged.
- Back up committed WAL data while the application database is open.
- Authenticate and verify encrypted copies before publication and retention.
- Retain 12 successful copies; preserve existing copies on snapshot failures.
- Refuse duplicate jobs, public destinations, wrong keys and unsafe restore targets.
- Restore only to a new private filename and verify members, dates and pairings.
- Generate Sunday 03:00 cron with explicit paths and the actual Node binary.
- Activation and a real scheduled run remain host-side steps, not completed by a GitHub push.

## Named games and upcoming-month navigation
- Admin Add date accepts an optional name; blank names preserve the current presentation.
- Admin Edit name changes a future game's name without changing its date or registrations.
- Names appear in desktop cells, mobile rows, selected dance card and accessible date labels.
- Long names wrap without clipping or horizontal overflow; markup is displayed as text.
- Initial entry opens the earliest month with a game on/after today, even across years or large gaps.
- Previous/next move only among months containing upcoming scheduled games; endpoints are disabled.
- Upcoming resets to the earliest upcoming month, even after browsing elsewhere.
- Only a globally empty future schedule displays No upcoming games; zero registrations do not count as empty.
- Expired selected months fall back to a valid month; network errors remain errors, not false empty states.
- Explicit additive migration retains every account, date, pair and session; repeated migration is safe.
- Old application and backup versions can still read the migrated database; names survive encrypted recovery.

## Restored club favicon
- Restore the original 64×64 PNG unchanged, not a newly drawn logo.
- Every page retains the favicon link because the site uses one HTML shell.
- GET/HEAD favicon requests return 200 and image/png; private paths remain blocked.
- Check About/Login/calendar, naming, skipped months, registration/cancellation and admin dialogs for regressions.
- Confirm the favicon loads in the hosted preview; homepage layout remains unchanged.

## Signed-in password changes
- Members and admins open Change password beside calendar controls, including an empty calendar.
- Password inputs use current/new-password autocomplete and remain masked.
- Enforce current password, 12–128 character replacement, matching confirmation and a different replacement.
- Wrong current password shows an inline error without signing the member out.
- Failed attempts are throttled per member, not shared across all members behind a proxy.
- Successful changes atomically save a salted hash and invalidate every session for that member.
- Success clears the form and returns to Login with a persistent confirmation.
- Old password and old sessions stop working; the new password signs in with the same role and registrations.
- One member cannot change another member's password; failure leaves all accounts intact.
- Closing/cancelling clears fields; keyboard focus, phone layout and the public two-button homepage remain intact.

## Private CSV member import
- Require an initialized private database with an administrator; never initialize or reset it implicitly.
- Read UTF-8 CSV with exactly name, email and initial-password headers, supporting normal CSV quoting.
- Keep real CSVs outside the application and public roots, with owner-only permissions.
- Default to dry run; require --apply for insertion and --skip-existing to skip existing addresses unchanged.
- Validate every row before writing; reject duplicate CSV emails, invalid values and unsafe files.
- Store salted password hashes and member roles only; never print rows or passwords.
- Recheck collisions inside a write transaction and roll back the entire import on insertion failure.
- Preserve existing accounts, roles, passwords, games, partnerships and sessions.
- Confirm imported accounts can log in, change passwords and survive database reopening.
- Keep actual import, credential delivery and removal of plaintext CSVs as explicit operator steps.
