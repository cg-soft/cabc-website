# Main flows and calendar layout checks

## No notices for one's own actions
- Own solo/placeholder registration and cancellation queue no self-notice.
- Own pair changes notify the affected other member; later partner actions may
  notify the original actor without changing their opt-out preference.
- Compare the actual actor's member ID, never display names or acting-for target.
- Delegated registration/cancellation still notifies the affected target, excluding
  the actual administrator even when that administrator is a partner/registrant.
- Whole-game cancellation excludes its actor and notifies all other real registrants.
- Worker skips older queued self-notices before contacting SMTP.
- Preserve no-op/rejection behavior, atomic rollback and opt-out suppression.

## About version diagnostics
- Preserve public About, club copy, photo note, logo, Home and Login.
- Show loaded frontend/backend versions and backend start time.
- Check matching/mismatched versions, old backend, network failure, invalid
  responses and navigating away during a slow request; no secrets in output.
- Public version API needs no login, uses no-store and does not mutate data.
- Release stamping updates both identifiers; tests detect unstamped code changes.
- Recheck desktop/375px, navigation, login/calendar, wildcard/acting controls,
  games/registration/teams, email preferences, account dialogs and export/install.

## Opt-out registration/cancellation emails
- Notifications default on for real members; self-only Email notifications preferences persist and do not follow the acting target.
- Registration notifies each changed real participant other than the actual actor once; no-op/rejected requests and standalone team changes enqueue nothing.
- Cancellation notifies affected members other than the actual actor; a former partner is told they remain registered/unpaired. Game cancellation snapshots all other real registrants before deletion.
- Queue inserts share the calendar transaction; opt-outs, inactive accounts, placeholders and changed addresses are suppressed, including at send time.
- Email opt-out links show a confirmation page without sign-in; GET/scanners cannot change preferences, and re-enabling revokes earlier links.
- Separate bounded worker uses authenticated implicit TLS to mail.cabc.club:465; sender calendar@cabc.club; disabled by default, always refuses preview data, no SMTP in request handlers/startup.
- Check retry/backoff, overlapping workers, interrupted/ambiguous sends, expired events, token privacy, old-schema compatibility and explicit repeatable migration with original row counts unchanged.
- Recheck desktop/375px, both roles, all existing calendar/game/member/team/export flows; never send real emails or modify production during QA.

## Split public-directory deployment
- Default installations still serve the application's public subdirectory.
- With PUBLIC_DIR set to an absolute external public_html directory, serve the homepage and allowlisted assets from that directory, with no fallback to stale bundled files.
- Keep unknown/private files blocked and preserve GET/HEAD, MIME/cache headers, sign-in and authenticated calendar behavior.
- Reject relative or unexpanded home-directory paths with an actionable startup error.
- Preserve the preview and existing frontend flows; no database migration or production modification.

## iPhone home-screen calendar
- Keep ordinary browser Home/About/Login unchanged; a standalone launch opens the calendar, or sign-in when no in-memory session exists.
- Supply the club's existing logo as opaque 180px Apple touch and 192/512px web-app icons; manifest uses relative scope/start URL and standalone display.
- Show installation instructions on Login and beneath the calendar in a normal browser, and hide them in standalone mode.
- Keep existing bearer-token sessions in memory only. No cookies, local storage, service worker, cached private calendar or offline mutation queue.
- Clearly signal an offline connection; failed offline actions do not claim success or change registrations. Reconnection reloads the current calendar.
- Resume/online refresh keeps selected date/month and acting target, but does not replace open forms or interrupt pending writes.
- Check phone portrait/landscape safe-area spacing, header alignment, dialog scrolling, ordinary desktop behavior, both roles, export and all existing game/member/team flows.
- Verify server MIME/cache headers for all new public assets and retain explicit static-file allowlisting; no database migration or production deployment.

## Acting for in the signed-in header
- Align the dropdown's top and bottom edges with Home and Log out, with Acting for above it; retain alignment both for Myself and when the signed-in-administrator caption wraps across several lines.
- Replace the administrator's plain login name with one Acting for selector beside Home and Log out, not a duplicate selector above the calendar.
- Myself names the signed-in administrator; while acting, show the actual administrator in the header and retain the named scheduling notice and Return to myself above the calendar.
- Ordinary members retain their login name and never receive the selector. Unsupported servers retain the login identity and the upgrade notice, with no acting selector.
- Preserve target exclusions, scoped writes, pending/modal locks, date/month selection, self-only export/password controls and full-reload reset.
- Check header alignment, long names, keyboard operation, sticky scrolling and no logo/button overlap at 320, 375, 480, 640, 768, 1000 and 1440px.
- Recheck public navigation, both preview roles, calendar/Show navigation, registration/cancellation, team controls, export and all administrator dialogs using fictional QA data only.
- This is a two-file frontend upgrade (public/app.js and public/style.css); no server or database migration.

## Administrator acting for a member
- Keep the signed-in administrator identity, password changes, export and account/game controls unchanged.
- Show a separate Acting for selector of active real members, with Myself as the default; exclude inactive members and all wildcards.
- Display a persistent named scheduling banner while acting; calendar marks, dance card, partner availability and team controls follow the selected member.
- Switching target preserves the date/month, resets the read-only wildcard view and cannot occur during an in-flight scheduling request or confirmation.
- Register solo, choose a real partner or guest/standby/unavailable, cancel with named impact confirmation, form and dissolve teams for the selected member.
- Apply normal closed-date, partnership, team and inactive-account rules. Revalidate authorization, target and reviewed game revision inside the write transaction.
- Reject missing confirmation, stale reviews, ordinary-member forged requests, inactive/wildcard targets and expired sessions without writes.
- When new browser assets meet the old server, hide the acting selector and explain the required server upgrade/restart; never send delegated requests to an unsupported server.
- Atomically audit administrator, target, game, action and before/after scheduling state. Failed writes produce no audit rows; game deletion preserves audit history.
- Install only the additive registration-audit table through an explicit repeatable migration; existing releases continue reading all original tables.
- Check desktop and 375px layouts, named confirmations, keyboard selection, rapid switching, stale data, both preview roles, all wildcard views and existing main flows.

## Align Show and month navigation
- On desktop/tablet, Show's dropdown and Previous month, Upcoming and Next month share top/bottom edges and a 44px height; its label has no inherited form margin.
- On narrow phones, preserve the full-width Show row above the navigation buttons with no extra label margin or horizontal overflow.
- When title and controls cannot fit side by side, wrap the header; never squeeze the month title into a narrow sliver.
- Check 375px, 480px, 481px, 640px, 768px, 900px, 1000px and 1440px, including resize in the same session.
- Change Show to each wildcard and back, navigate months/Upcoming, and verify keyboard selection.
- Preserve Add date, edit/delete review, public navigation, both preview roles, registrations/teams, export and administrator dialogs. CSS-only runtime upgrade; no database or server changes.

## Edit and delete games
- Administrators see Edit game and Delete game on the selected current/future game's dance card; members and past games have no such controls.
- Edit opens with the stored name/date/time and fixed event type. Saving preserves game ID, every registration, partnership and team; the calendar follows a moved game to its new month.
- Validate real current/future dates, 24-hour time, name length and duplicate dates; rejected edits leave all data intact.
- Delete reviews the exact name/date/time, registered-member and team counts, then requires an explicit Delete game confirmation; Cancel is initially focused.
- Delete atomically removes only that game and its entries/teams. Other games/accounts/sessions remain intact; deleting a month's last game selects another available month, or the global empty state.
- Both operations require a fresh reviewed revision; changed game details, registrations or teams cause a conflict without applying anything. Closing and reopening fetches a fresh review.
- Disable submit, close and Escape during save/delete; cancellation before submission never writes.
- Preserve existing Add date month defaults, public navigation, both preview roles, wildcard views, pairing, cancellation, team controls, export and other administrator dialogs.
- Test desktop/mobile dialogs, long names, markup escaping, keyboard focus, errors, stale reviews, cross-month edits, deletion with registrations/teams and deletion of the last upcoming game using fictional QA data only.

## Add date follows the displayed month
- As administrator, navigate to a future month and open + Add date: Date defaults to that month's first day.
- In the current month, default to today rather than a past first day; retain today's minimum date.
- Reopen after navigating to another month, including across a year boundary; do not reuse an unsaved value.
- With no loaded month or no upcoming games, default to today.
- Keep the date editable, Pairs as the default, Teams available, and 11:30 as the initial start time.
- Recheck public navigation, both preview roles, calendar navigation, wildcard filter, registration/cancellation, teams, export and admin dialogs at desktop and mobile widths.

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
- Admin Edit game replaces Edit name and changes a current/future game's name, date and time while retaining registrations.
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
