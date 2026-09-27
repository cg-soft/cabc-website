# Source map

## Request flow

```text
Browser: React UI
    |
    | Same-origin /api requests
    | Explicit Authorization: Bearer token after login
    v
Express server
    |
    +-- Input validation, authentication, administrator checks
    |
    v
DatabaseStorage / Drizzle / SQLite
    |
    +-- Persistent, private database outside the public web root
```

## Files to read first

| File                                    | Purpose                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `client/src/App.tsx`                    | Public pages, hash-based routing, sign-in forms, member navigation, administration |
| `client/src/index.css`                  | Approved typography, palette, page layouts, mobile and dark-mode styling           |
| `client/src/components/DanceCards.tsx`  | Dance Cards views, booking/cancellation confirmation, standby and schedule form    |
| `client/src/components/dance-cards.css` | Dance Cards-specific styles                                                        |
| `client/src/lib/queryClient.ts`         | Same-origin API requests, in-memory token, query caching and error handling        |
| `shared/schema.ts`                      | Database tables, shared types, strict Zod input validation                         |
| `server/index.ts`                       | Express setup, response headers, private-path blocking, error handling, startup    |
| `server/routes.ts`                      | Public, member and administrator API routes, auth and rate-limit guards            |
| `server/storage.ts`                     | Authentication, owner bootstrap, membership operations and dance-card transactions |
| `server/static.ts`                      | Production serving of `dist/public` only                                           |
| `server/vite.ts`                        | Development-only Vite integration                                                  |
| `script/build.ts`                       | Builds frontend and backend                                                        |
| `tests/backend-test.ts`                 | Original access, privacy, auth and membership lifecycle tests                      |
| `tests/dance-test.ts`                   | Dance Cards privacy, reciprocal booking, conflicts and lifecycle tests             |

`client/src/components/ui/` contains reusable UI primitives inherited from the
application template. Not every primitive is currently used.

## Common changes

- **Change public copy:** Edit page components in App.tsx, or use the
  administrator's club settings where that page reads saved settings.
- **Change colors:** Review the CSS variables and the branding overrides in
  index.css. Keep light and dark themes consistent.
- **Replace the logo/image:** Replace the corresponding files in
  `client/public/images/` and update alt text if the content changes.
- **Add a member feature:** Add its schema/validation, storage methods, guarded
  routes, frontend controls and automated tests.
- **Change API behavior:** Use routes.ts for HTTP rules and storage.ts for data
  operations. Keep user IDs server-derived from authenticated sessions.

## Dance Cards rules

- Members explicitly opt into a separate roster. Directory opt-in is independent.
- Roster responses expose names and numeric IDs, not emails or biographies.
- A member records an already-agreed partnership involving themselves. There is
  no invitation/acceptance queue and no notification email.
- Two reciprocal slots are written in one immediate SQLite transaction.
- A member can have only one partner per dance-card date.
- Either partner or an administrator can cancel both slots.
- A shared random booking ID prevents an old cancellation request from
  cancelling a replacement partnership.
- Booking replaces standby entries for the pair.
- Past dates are read-only, determined by the calendar date in
  `America/Los_Angeles`. A current-day card remains editable for that day.
- Administrators can add 1–52 Monday dates, within a two-year horizon. Existing
  dates are skipped, not changed. Add a special title as a one-week schedule
  before adding a generic schedule spanning that date.
- Games and Dance Cards share one row per San Francisco calendar date.
  `dance_attendance` is the date-level RSVP record; associated calendar
  `rsvps` are kept synchronized. Booking marks both partners as attending.
- Available-member IDs are calculated on the server from roster enrollment,
  partnership status and explicit “Not playing” responses. Booking rechecks
  those rules within the write transaction.
- Cancelling a pair preserves both RSVPs. Declining a paired date must include
  the current booking ID and atomically clears the pair while preserving the
  former partner's attendance.
- Each row opens a full lineup showing each reciprocal pair once, with standby
  and unpaired roster members listed separately.
- Roster departure is blocked until upcoming commitments have been cleared.
- The UI refreshes every 30 seconds, while every write checks current server
  state. It also supports manual refresh.

## Database changes

Explicit migrations are in `server/migrations/`; the CLI is `server/migrate.ts`.
`server/database.ts` checks compatibility at startup and never repairs schemas.
Version three adds date-level attendance, groups calendar events by San Francisco
date and carries forward existing RSVPs and booked/standby commitments.

See `docs/DEPLOYMENT.md` for initialization, backups, upgrades and recovery.
The `db:push` shortcut has been removed. Do not substitute direct Drizzle schema
pushes for reviewed migrations against the operating club database.

`script/build.ts` supports independent UI and backend builds. `script/release.ts`
creates checksum-manifested payloads; `script/verify-release.ts` verifies them.
`runtime/package*.json` define the hosted native runtime dependency tree.
`shared/release-contract.ts` records manually maintained API/schema requirements.

## Differences from the preview source

Earlier handoff changes covered packaging/portability and formatting; the
current release additionally separates builds and makes migrations explicit:

- Default database and setup paths resolve from the project directory rather
  than an absolute sandbox path.
- The development dependency allowlist uses the current project path.
- Browser API calls use the same origin, with no Perplexity port placeholder.
- The Drizzle configuration uses the same database-path default as the server.
- Formatting commands, documentation and a sample environment file are added.

The package does not connect back to the preview, Perplexity, Google Drive or
Google Sheets. Fonts are loaded from the external URLs in `client/index.html`;
the club image assets themselves are included.
