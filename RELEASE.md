# CABC Minimal Website: Hosting Source

Prepared October 20, 2026. This is the separate minimal website, including the
revised desktop calendar, mobile playing-date list and dance-card panel.

## Start here

1. Read `README.md` for scope and behavior.
2. Follow `HOSTING.md` for runtime checks, application paths and fresh setup.
3. Use `app.cjs` as the hosting startup file, or run `npm start`.
4. Keep the database outside the application and public upload folders.

No build or npm dependency installation is needed. The ZIP contains readable
source, public assets, tests, documentation and a generated `SHA256SUMS` manifest.
Tests run with `npm test` or `node --test tests.mjs hosting-tests.mjs`.

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
The database schema remains version 1; ordinary startup never runs migrations.

The repository now contains this minimal implementation with deliberately reset
history, as authorized by the owner. The live Dathorn site, DNS and published
preview have not been changed by this repository replacement.
Confirm the target server's runtime and routing,
configure HTTPS and backups, and test the installation before inviting members.
