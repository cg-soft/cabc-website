# CABC Minimal Website: Hosting Source

Updated October 29, 2026. This is the separate minimal website, including
an online iPhone home-screen calendar and installation help, as well as
administrator scheduling on behalf of members, an atomic scheduling audit,
game editing/deletion, wildcard statuses, teams and mobile dance cards.
Split application/public installations should follow `SPLIT-PUBLIC-DIRECTORY.md`
for the configurable public directory. This correction needs only `server.mjs`,
the `PUBLIC_DIR` environment setting and a restart, with no migration.
Current administrator-scheduling installations should follow `HOME-SCREEN.md`;
this release requires no migration. Earlier installations must first follow
`ACTING-FOR-MEMBERS.md`, including its explicit registration-audit migration,
and apply
the prerequisite feature migrations described in `HOSTING.md`.

## Start here

1. Read `README.md` for scope and behavior.
2. Follow `HOSTING.md` for runtime checks, application paths and fresh setup.
3. Use `app.cjs` as the hosting startup file, or run `npm start`.
4. Keep the database outside the application and public upload folders.

No build or npm dependency installation is needed. The ZIP contains readable
source, public assets, tests, documentation and a generated `SHA256SUMS` manifest.
Tests run with `npm test`, covering the application, hosting, backups, calendar
selection and migration safety.

## Verification

All 219 tests pass on Node 22.23.2 and 24.20.0. Browser workflows were checked
with fictional preview accounts, including delegated scheduling, stale-action
rejection, mobile layout and existing account/calendar controls. See `QA.md`
for what was tested and what remains host-specific.

After extracting, verify the files from the `cabc-minimal` directory:

```bash
# Linux
sha256sum -c SHA256SUMS
# macOS
shasum -a 256 -c SHA256SUMS
```

The hashes detect accidental file changes; they are not a digital signature.

## Boundaries

No production data, preview database, passwords, environment files, dependency
folder or Git history is included. No migration from the old website is included.
The database retains baseline version 1 plus additive game-name, team,
member-status and registration-audit features. Existing databases require
explicit feature migrations; ordinary startup never runs migrations.

The repository contains the minimal implementation with fresh-start history,
as authorized by the owner. Repository and preview updates do not deploy to
Dathorn, alter DNS, or run production migrations. Follow the upgrade guide and
verify the target installation before inviting members.
