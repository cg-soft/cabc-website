# Administrator scheduling on behalf of members

## Use Acting for

Sign in with your own administrator account and open Playing dates. The new
Acting for selector replaces your plain login name in the header, beside Home
and Log out. It is separate from the read-only wildcard Show selector.
It defaults to Myself and lists other active real members, including other
administrators. The numeric member ID distinguishes duplicate names.
Inactive accounts and shared wildcard placeholders cannot be acting targets.

Choose a member. The banner names that member and the signed-in administrator.
The header also identifies the administrator while another member is selected.
Calendar registration checks, the mobile agenda, partner choices and team
controls now follow the selected member. The selected game and month stay
unchanged. Choosing a target also returns Show to All members.

- Register for the named member alone or with an available real partner.
- Assign -Guest-, -Standby- or -Unavailable- using the normal partner selector.
- Cancel their registration after reviewing the named confirmation. Their
  real partner remains registered as a single; a complete team dissolves.
- To change an existing partner or wildcard status, cancel the current
  registration first, then register with the new choice. Cancellation explains
  its partnership/team effects; no existing partnership is silently overwritten.
- For team events, form a team from two complete available pairs, or leave the
  selected member's team after confirmation. Both pairs remain registered.
- Choose Return to myself, or select Myself, to resume your own scheduling.
  A fresh login/reload also defaults to Myself.

The administrator remains signed in throughout. Export my games and Change
password always apply to that administrator, not the selected member.
Member creation, deactivation and game administration remain explicitly
named, separate controls. This is not an impersonation login and does not
give access to someone else's password or personal calendar export.

## Header-only layout upgrade

If administrator scheduling is already installed and working, upload only
`public/app.js` and `public/style.css` from this release, then reload the browser
and sign in again. This layout change requires no server update or migration.
The full initial installation instructions below still apply when upgrading
from a release without administrator scheduling.

## Safeguards and audit records

Normal availability, existing-partnership, team and closed-date rules remain
in force. Delegated requests require administrator authorization, an active
real target, explicit confirmation and the calendar's current reviewed game
revision. Authorization and eligibility are checked again under the same
write transaction as the mutation. Changes to the game, its registrations or
teams reject a stale request; refresh and review before retrying.

Target selection and dialog dismissal are blocked during an in-flight
scheduling write. On failure the calendar refreshes and explains the error.
The Show selector remains a read-only wildcard schedule, not an acting target.

Each successful delegated action inserts one private registration_audit row
in the same transaction. It records the timestamp, administrator ID/name,
target ID/name, game ID/date, action and before/after entry/team rows for that
game. It contains no passwords, login tokens or email addresses. If audit
insertion fails, the scheduling change rolls back. Game deletion preserves
audit history. Ordinary self-service requests are unchanged and are not
recorded by this feature.

Audit history is included automatically in database backups. There is no
audit-history screen or automatic notification in this release; an operator
can inspect the private database with SQLite tooling. For example:

```sql
SELECT created_at, actor_name, target_name, game_date, action
FROM registration_audit
ORDER BY id DESC
LIMIT 100;
```

## Dathorn upgrade

This work updates GitHub and the fictional-data preview only. The owner must
perform production deployment manually. Do not copy a preview database or
preview/config.js to Dathorn, and do not rerun initialization.

For an installation already running the previous release:

1. Make and verify a backup of the existing private production database.
2. Stop the application and retain copies of the previous runtime files.
3. Upload these seven files from the new release:

   ```text
   server.mjs
   db.mjs
   migrate.mjs
   registration-audit-schema.sql
   package.json
   public/app.js
   public/style.css
   ```

4. In the application directory, use the same Node binary and absolute DB_PATH
   as the running application, then explicitly run:

   ```bash
   DB_PATH=/absolute/private/path/club.sqlite node migrate.mjs registration-audit
   ```

   Confirm that every existing table's Before and After count matches.
   The migration only adds registration_audit and a migration metadata marker;
   it keeps baseline user_version=1 and all existing rows. It is repeatable.
   It requires the earlier member-status/team migrations to be present.

5. Restart the application. There is no build or dependency installation.
6. Fully reload the browser and sign in as an administrator. Confirm that
   Acting for defaults to Myself, select a consenting test member, verify a
   reversible scheduling action, return to Myself, and check the audit record.
   Verify that a regular member has no Acting for control.

If old assets persist in iOS Safari, clear this site's Website Data, fully
close Safari and reopen it. Browser refresh alone may retain stale assets.
No cache-busting URL changes are part of this release.

Startup never creates the audit table in an existing database. If the
migration is omitted, delegated scheduling fails clearly with a migration
message and writes nothing; ordinary self-service remains available.
If new browser files are loaded while the previous server is still running,
the selector stays unavailable with an upgrade/restart message. It cannot
silently submit another member's request to that older server.
Fresh initialization includes the table. Rollback to the previous server
and browser files can leave the additive audit table in place; old versions
continue reading their original tables, but cannot offer delegated scheduling.
