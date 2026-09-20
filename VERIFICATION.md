# Handoff verification

This archive contains the September 16, 2026 unified Games & Dance Cards
release. Packaging retains portable private-storage paths, same-origin API
requests and readable Prettier-formatted source.

The release now also includes a printable pair list for every date. See
PRINT-PAIR-LIST-QA.md for print-button, mobile, dark-mode, empty-date and
100-pair pagination verification. No real member printouts are packaged.

## Checks

The updated source passed type checking, 42 automated tests and a production
build. The test count includes 23 original backend subtests, 17 dance-card and
unified-schedule subtests, and two enclosing tests.

Tests cover authentication, invite/recovery lifecycles, privacy, administrator
authorization, reciprocal bookings, concurrent conflicts, availability
filtering, integrated RSVPs, stale cancellation protection, standby, complete
multi-pair data, historical protection, persistence and version-two upgrades.

The portable archive was checked with Node.js 22.23.2 and npm 10.8.2, using
the included dependency lockfile. See UNIFIED-SCHEDULE-QA.md for the browser
acceptance inventory and results.

Initial packaging already verified clean installation, production and
development startup, development module serving, fresh owner setup, anonymous
endpoint denial, private-file download blocking and mode-600 private files.
The updated package reruns formatting, type checks, tests and production build.
All runtime tests use synthetic data, never real member credentials.

## Dependency installation correction

The revised package pins the direct `esbuild` dependency to `0.28.2` and adds
an `esbuild: "$esbuild"` npm override. A regenerated lockfile resolves all
esbuild consumers and platform-specific esbuild packages to `0.28.2`.
The archive now also includes `tailwind.config.ts`, which was accidentally
omitted from the earlier ZIP.

Verification used an extracted copy of the delivered archive, with these
corrected files, under Node.js 22.23.2 and npm 10.8.2:

- Clean `npm ci --include=dev --no-audit --no-fund`: passed.
- `npm ls esbuild --all`: all consumers resolve to `0.28.2`.
- `npm run check`: passed.
- `npm test`: all 42 tests passed.
- `npm run build`: passed with the restored Tailwind configuration.
- Drizzle Kit migration generation: successfully loaded the configuration and
  processed all 15 schema tables in a disposable test directory. Generated
  test migrations are not included in this package, and no club database was
  changed.

The original archive also installed successfully in this Linux test
environment. Therefore, the user's exact installation error was not
reproduced, and multiple esbuild versions alone were not established as its
cause. The revised package removes that version difference and verifies
compatibility with the included build and migration tooling. Other operating
systems and npm versions have not been tested.

## Launch and audit limits

No hosting account or custom domain was provisioned. Operational and security
requirements in HOSTING.md and SECURITY.md remain launch prerequisites.
The current preview's accounts and database are not included in this archive.

Dependency installation previously reported deprecations for prebuild-install
and Recharts 2.x. A full dependency vulnerability audit and major-version
upgrades were not performed. This package is not a production security audit.
