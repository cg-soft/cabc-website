# CABC Minimal Website: Hosting Source

Updated October 22, 2026. This is the separate minimal website, including named
games, upcoming-month navigation, mobile playing-date lists and dance cards.
Existing installations must follow `UPGRADE-GAME-NAMES.md` before starting
this version against their existing database.

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

The application and hosting-startup suites pass on Node 22.23.2. Fresh
administrator initialization and production-mode browser workflows were also
checked. See `QA.md` for what was tested and what remains host-specific.

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
The database retains baseline version 1 plus an optional game-name column.
The new column has an explicit additive migration; ordinary startup never
runs migrations.

The repository contains the minimal implementation with fresh-start history,
as authorized by the owner. Repository and preview updates do not deploy to
Dathorn, alter DNS, or run production migrations. Follow the upgrade guide and
verify the target installation before inviting members.
