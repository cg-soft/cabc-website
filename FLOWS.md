# Main flows and calendar layout checks

## Wildcard placeholder members
- Recognize exactly "-Unavailable-", "-Standby-" and "-Guest-" member names as shared placeholders; other hyphenated names are ordinary members.
- Placeholder accounts cannot sign in; sessions and preview bypass are refused with 401.
- A member registers with a placeholder as a one-directional assignment (no reciprocal row), so many members can overbook the same placeholder in one game.
- "-Guest-" completes a playing pair; "-Standby-" (member substitutes at the last moment) and "-Unavailable-" (member blocked from being chosen as partner) are member states, not pairs.
- Standby and unavailable members cannot form teams; guests can, and two guest pairs may share one team with only real member IDs stored.
- Registration and cancellation clean up legacy reciprocal placeholder-owned rows; calendar reads exclude them.
- A "Show" selector above the calendar lists each placeholder's upcoming assignments across all future months, with jump buttons that select the game's month and date.
- Calendar cells and agenda annotate per-game assignment counts for the selected placeholder; the dance card shows Standby and Unavailable sections.
- Placeholder deactivation review counts future assignments and affected games; applying it clears assignments, leaving members as registered singles.
- Check overbooking, state labels, cancellation, teams, cross-month schedules, placeholder sign-in, deactivation, mobile layout and the Show selector.

## Smaller mobile logo
- At widths up to 640px, show the unchanged transparent logo at 48px wide instead of 64px on Home, About, Login and member/admin Calendar.
- Preserve its aspect ratio and upper-left position, centered in each page's existing header.
- Keep desktop/tablet widths above 640px at 72px and retain navigation clearance.
- Check 320px, 375px, 640px, 641px and 1440px, scrolling and open dialogs for overlap or overflow.
- Recheck public navigation, both preview roles, calendar navigation, partnerships, teams, exports and admin dialogs; no backend/schema changes.

## Deactivate member
- Admin-only selector shows account names/emails and active/inactive status; members cannot access its API.
- Review names the target and counts their registrations for today/later and affected teams.
- Final explicit confirmation is bound to that reviewed account/impact; stale plans require review again.
- Deactivation revokes all sessions, blocks password and preview login, and excludes the member from available-partner selection.
- Clear only today/future registrations, leaving former partners registered as singles and unaffected pairs intact.
- Preserve all account fields and historical registrations/teams; store deactivation timestamp and administrator ID.
- Do not allow deactivation of the last active administrator. Self-deactivation with another active admin signs out.
- Repeated deactivation is harmless; reset-password, promote and CSV import do not reactivate accounts.
- Additive, repeatable member-status migration defaults all existing members to active; normal startup never migrates.
- Database guards stop older app versions creating sessions/registrations for inactive members.
- Check mobile, keyboard focus, cancellation, failures, stale reviews, authentication, teams, exports and floating logo.

## Floating transparent club logo
- Use the exact transparent PNG from the separate logo project, preserving its colors and alpha channel.
- Render one persistent noninteractive logo outside the route container, on Home, About, Login and member/admin Calendar.
- Pin it to the upper left while scrolling; reserve a sticky header lane so content/navigation cannot pass behind it.
- Keep the home page's only two buttons, About and Login, and preserve the supplied favicon.
- Use a compact logo on mobile, replacing the duplicate visible wordmark rather than crowding navigation.
- Check 320px, 375px, tablet and desktop, scrolled calendar, dialog stacking and keyboard focus.
- Verify public PNG GET/HEAD, no duplicate logos after route changes, and image availability in production and preview.
- Recheck authentication, pair/team registration, exports, password form and administrator dialogs.

## Team events
- Admin selects Pairs (default) or Teams when adding a date; existing dates remain Pairs.
- Calendar desktop/mobile identifies team events and shows completed-team counts.
- Pair registration is unchanged; singles cannot form teams until paired.
- Either member of either complete pair can immediately combine with one other available complete pair.
- Validate both partnerships under a write lock; never let anyone join two teams on the same date.
- Show all four players in each team, pairs seeking teammates, and singles seeking partners.
- Either member may leave their own team; both pairs remain registered and available.
- Cancellation/broken partnership dissolves its entire team; unaffected pair stays paired.
- Old server cancellation SQL also dissolves teams through additive database triggers.
- Reject stale selections, other people's teams, pair-event requests, expired sessions and closed dates.
- Explicit team-events migration preserves baseline rows, is repeatable, and is never run on normal startup.
- Export still contains one game per personal registration and preserves historical event IDs.
- Recheck home/About/login, month selection, admin dialogs, passwords, export and pair-event workflows.

## Export my registered games
- Members and administrators see Export my games beside calendar controls on desktop and mobile.
- Download cabc-my-games.ics containing only the signed-in member's registrations for today or later, across all months.
- Include paired and unpaired registrations once each; exclude past, cancelled and other members' games.
- Use game names (with a club-name fallback), Pacific time including daylight-saving rules, and a link to the club site.
- Do not invent end times, publish subscription links, or export names/emails/passwords of members.
- No registrations produces a clear message and no empty download.
- Handle expired sessions and failed downloads without exposing credentials or changing registrations.
- Confirm stable event IDs, escaped/folded Unicode text and unchanged database records.
- Exported website links use https://cabc.club/#calendar; preserve the legacy @bridge.cabc.club UID suffix exactly.
- Recheck the public two-button homepage, About, login, date navigation, registration/cancellation, admin dialogs and password form.

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
