# Build separation and explicit migration verification

This change preserves the frontend source and visual design. It was tested in
an isolated Linux x64 environment under Node.js 22.23.2 and npm 10.8.2, not on
the user's Dathorn server or macOS development machine.

## Automated results

- Type checking: passed, including the new build/release scripts.
- `npm test`: 54 tests passed, including the existing authentication and
  dance-card suites plus migration and build-configuration tests.
- `npm run test:release`: 5 tests passed, including the enclosing suite.
- Independent production UI and server builds: passed.
- Runtime-only install with `npm ci --omit=dev`: passed in a disposable Linux
  directory using the dedicated runtime lockfile.

## Migration guarantees exercised

- Missing schema fails server startup without creating a database or owner code.
- Explicit initialization creates schema but no bootstrap credentials.
- Legacy v0/v1/v2 upgrades preserve users, password hashes, sessions,
  invitations, recovery records, settings, events, RSVPs, and reciprocal pairs.
- Attendance is backfilled, existing date rows are reused, and rerunning the
  migration is a no-op for a compatible v3 database.
- A deliberately invalid event date causes the DDL, backfill and version update
  to roll back together.
- Future schemas, damaged v3 schemas, unrecognized databases, invalid foreign
  keys, and public/build-directory storage are rejected.
- Concurrent migration commands serialize and recheck the version after
  obtaining the transaction lock; exactly one performs the upgrade.
- CLI mutation requires explicit flags; status does not initialize the database.

## Release guarantees exercised

- UI builds leave backend bundles unchanged; server builds leave UI files unchanged.
- `.htaccess` preservation, including permissions/inode in cleanup tests.
- Stale frontend output is removed locally; stale source or modified built
  artifacts are rejected during packaging.
- UI/server/full/runtime payloads contain only their expected file classes.
- Existing release IDs cannot be overwritten.
- Payload tampering and incompatible API/runtime manifests are rejected.
- Compiled server and migration bundles run without source, Vite, tsx, or a
  separate Express installation.
- Production smoke checks cover homepage, explicit initialization/status,
  first-owner setup, authenticated member access, anonymous rejection,
  private-path rejection, orderly shutdown and repeat migration.

## Limits

No production member data was used. No remote files, database, Git branch,
pull request, hosting account, DNS or routing configuration were changed by
these tests. The native package installed successfully in this sandbox; that
does not prove Dathorn compiler availability or CloudLinux installation behavior.

The release verifier checks local payloads and supplied metadata, not the live
server. Backup acknowledgment is not a backup verification mechanism.
Native runtime maintenance, staging activation, checksum checking after transfer,
and cPanel restarts remain supervised operator steps.
