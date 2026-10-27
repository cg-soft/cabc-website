# Wildcard placeholder members: usage and Dathorn upgrade

The club has three shared placeholder accounts, named exactly `-Unavailable-`,
`-Standby-` and `-Guest-`. They let one real member's status be recorded on a
game without reserving a real partner, and they can be overbooked: several
members may use the same placeholder in the same game. Placeholder accounts
cannot sign in and are never emailed.

## What each placeholder means

- **`-Guest-` completes a playing pair.** The member is playing with an
  unregistered guest. The pair counts as a full partnership for pair counts
  and can form a team with another pair. Two members may each bring a guest
  (the same placeholder) and form one team; only the real members are stored
  on the team.
- **`-Standby-` is a member state.** The member takes the standby role and
  can substitute at the last moment. A standby member is not a pair, cannot
  be chosen as another member's partner, and cannot form a team.
- **`-Unavailable-` blocks the member from being chosen as a partner.** The
  member is registered but unavailable. Like standby, it is not a pair and
  cannot form a team.

## How it works

- When a member registers with a placeholder partner, only that member's own
  row is stored (partner = placeholder). Real partners keep the usual two
  symmetric rows. This is what allows overbooking without any schema change.
- Legacy reciprocal rows owned by a placeholder (if the old server wrote
  them) are excluded from calendar reads and cleaned up on registration and
  cancellation.
- The **Show** selector above the calendar lists every placeholder's upcoming
  schedule across all future months. Choosing one replaces the dance card
  with the placeholder's schedule; each entry has a jump button that selects
  that game's month and date. Calendar cells and the agenda annotate how
  many assignments the selected placeholder has per game.
- The dance card groups members by state: Standby and Unavailable members
  appear in their own sections below the pairs list.
- Cancelling a registration removes only the cancelling member's placeholder
  assignment. Other members' assignments with the same placeholder remain.
- Deactivating a placeholder account (administrator flow) removes its future
  assignments; affected members remain registered as singles. The review
  counts assignments and affected games before anything changes.

## Dathorn upgrade

This release **does not require a database migration**. The three placeholder
accounts are ordinary member rows; if they do not exist yet in the live
database, create them with `node manage.mjs add-member` using their exact
names and strong private passwords (they can never sign in, but keep the
credentials in your password manager).

Upload these four files, replacing the previous versions:

- `server.mjs`
- `db.mjs`
- `public/app.js`
- `public/style.css`

Then restart the application. Verify on the live site that the Show selector
appears once signed in, that a member can register with `-Guest-`, and that
placeholder accounts cannot sign in. Weekly backups are unchanged.

Rollback: restoring the previous four files and restarting returns the
application to the previous release, but data written by this version is
**not automatically compatible with the old client**: one-directional
placeholder assignments make the old client's pair counts divide partnered
rows by two, and the old team logic expects reciprocal rows. Before rolling
back, an administrator should clear placeholder assignments for today and
later (the deactivation review lists them), which leaves the affected members
registered as singles the old client renders correctly. Do not roll back with
future placeholder assignments still in place, and do not attempt production
cleanup with automated scripts; use the administrator flows described above.
Placeholder-owned rows, if any were written by the old server, are ignored by
this release and can be removed by an administrator while it is installed.
