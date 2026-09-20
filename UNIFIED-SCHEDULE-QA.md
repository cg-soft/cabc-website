# Unified schedule QA

## Acceptance inventory

- Navigation: one Games & Dance Cards area; Overview opens it; no separate RSVP tab.
- Density: one table row per San Francisco date, compact inline RSVP and partner controls.
- RSVP: yes/no, RSVP without roster opt-in, automatic attendance for both booked players.
- Availability: only opted-in, unpaired, non-declined members; exclude self; handle an empty list.
- Concurrency: stale dropdown selections and stale partnership cancellations rejected by the server.
- Cancellation: cancel pair retains both RSVPs; decline with a current booking confirmation cancels the pair and retains the partner's RSVP.
- Date lineup: every pair once, game details, total attendance, standby, unpaired roster members.
- Other controls: member-card selector, history, refresh, standby, roster join/leave, admin dates.
- Privacy: no anonymous schedule access; non-roster names are not exposed; other accounts cannot be impersonated.
- Migration: additive version-three upgrade, event records and bookings preserved; events sharing a local date grouped without deleting records.
- Visual: desktop and 375px mobile, light/dark, dialogs, populated and empty controls; no page-level horizontal overflow.

## Deliberate behavior

An opted-in, unpaired member with no RSVP is selectable, but is not counted as attending until they RSVP, join standby, or are booked. “Not playing” removes a member from the date's availability list. Partner agreement happens outside the site before booking; there is no new invitation-acceptance workflow.

Attendance and partnerships are date-level. If multiple calendar listings share a date, all their details remain visible and the RSVP applies to all listings on that date. Creating Monday dates does not automatically publish public calendar listings.

## Verification results

Verified September 16, 2026. Type checking and production build passed. The
automated run passed 42 tests: 23 original backend subtests, 17 dance-card and
unified-schedule subtests, and their two enclosing tests.

Browser QA used synthetic accounts on the isolated test database, not the club's
member accounts. Desktop 1440px and mobile 375px checks covered light/dark
presentation, compact rows, date-lineup dialogs, empty availability lists,
member-card views, history, RSVP changes, booking, cancellation, standby,
refresh, duplicate admin schedule creation and roster-withdrawal protection.
The cancellation-confirmation Go back path preserved the original RSVP.
Declining a paired date left the former partner RSVP'd as playing.

No JavaScript page errors were observed. The mobile page had no horizontal
overflow; the table deliberately scrolls sideways, with a visible instruction.
Dialogs fit inside the mobile viewport with 16px side margins. Pair names wrap
inside the dialog rather than clipping. Automated tests additionally cover two
distinct pairs on one date, forged actors, simultaneous booking conflicts,
stale cancellation IDs, non-roster privacy and version-two database migration.

A private mode-600 SQLite backup was taken before the preview migration.
No member data is included in the source ZIP and no Google Sheet was changed.
