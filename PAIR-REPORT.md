# Upcoming pair report

Lists every registered pair for every upcoming game, then how many upcoming dates each pair is registered together. Read-only; no migration or restart needed. Only `manage.mjs` and `pair-report.mjs` are needed on the server.

```
env DB_PATH=/home/cabc/src/cabc-minimal/private/cabc-minimal /opt/alt/alt-nodejs24/root/usr/bin/node manage.mjs pair-report
```

- Upcoming means today (Pacific time) and later.
- A member playing with a guest is listed as "Name & -Guest-" and counted as a pair.
- Standby, unavailable and director registrations are not pairs and are left out. Members without a partner appear as "Looking for a partner" on that date.
- Only current registrations are counted; cancelled registrations leave no record.

## How often each pair has played together

Add `--played` to count every game on record, past and upcoming:

```
env DB_PATH=... /opt/alt/alt-nodejs24/root/usr/bin/node manage.mjs pair-report --played
```

One line per pair: games already played, upcoming games, the date last played, and the pair, most-played first. A game counts as played once its date is before today (Pacific time). Only registrations still in the database are counted, so cancelled registrations and deleted games are not included.
