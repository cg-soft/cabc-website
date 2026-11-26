# Login history

Every successful sign-in is recorded with a timestamp, the member's name and email at that moment, and whether "Remember this device" was used. Failed attempts, passwords and session tokens are never recorded. The history is append-only and kept even if a member is deactivated or merged. It is visible only from the command line; there is no web page for it.

## Install on an existing database

Existing databases need one explicit, additive migration (it never runs automatically, and sign-in keeps working before it is run, it just records nothing):

```
env DB_PATH=/home/cabc/src/cabc-minimal/private/cabc-minimal /opt/alt/alt-nodejs24/root/usr/bin/node migrate.mjs login-history
```

Back up the database first (see BACKUPS.md). Upload `server.mjs`, `release.mjs`, `public/` and `login-history-schema.sql`, then restart the application. New databases created with `manage.mjs init` include the table.

## View the history

```
env DB_PATH=/home/cabc/src/cabc-minimal/private/cabc-minimal /opt/alt/alt-nodejs24/root/usr/bin/node manage.mjs login-history [days]
```

Lists successful sign-ins for the last `days` days (default 30), newest first, in Pacific time, followed by the number of distinct members. The command only reads the database.
