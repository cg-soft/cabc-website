# Off-server builds and explicit migrations

This workflow keeps application builds on your development machine. Dathorn only serves the compiled application and installs its small native runtime when necessary. No command in the release tooling uploads files, modifies Dathorn, or performs automatic deployment.

## What changed

- **Independent builds:** `build:ui` updates `dist/public` without changing the server. `build:server` updates `dist/index.cjs` and `dist/migrate.cjs` without changing the frontend.
- **Minimal runtime:** Ordinary JavaScript dependencies are bundled. The only required external npm package is `better-sqlite3`, pinned to `11.10.0` with a separate runtime lockfile. Its transitive packages are installed normally; copying just the native binary is not sufficient.
- **Explicit migrations:** Server startup checks schema compatibility but does not create tables or run migrations. Fresh installation and legacy upgrades use the migration CLI.
- **Protected state:** Release payloads exclude databases, secrets, `.htaccess`, source, development dependencies, and build receipts.

Keep the Dathorn application root `/home/cabc/src/cabc-website`, document root `dist/public`, and startup file `dist/index.cjs`. Use Node 22.23.2, Production mode, the existing domain at its root, and the panel-provided Node environment. No `/bridge` path is introduced.

## Local preparation

Use the source repository with Node 22.23.2. Run these commands from its root, not inside `runtime/`:

```bash
npm ci --include=dev
npm run check
npm test
npm run test:release
```

`test:release` performs complete builds, creates temporary release payloads, installs the minimal runtime in a disposable directory, and runs production smoke tests with synthetic data. It accesses the npm registry and never contacts the production site.

For a fresh local development database:

```bash
cp .env.example .env
npm run migrate -- --apply --init
npm run dev
```

For an existing database, do not use `--init`. Follow the backup and upgrade procedure below.

## Build and package

Choose a unique release ID for each package. Packaging refuses to overwrite an existing release directory.

### UI-only change

```bash
npm run build:ui
npm run release -- ui 20260927-ui-01
npm run release:verify -- release/20260927-ui-01
```

The payload contains only `dist/public/...`. It contains no server bundle or runtime manifest.

### Backend or schema change

```bash
npm run build:server
npm run release -- server 20260927-server-01
npm run release:verify -- release/20260927-server-01
```

The payload contains `dist/index.cjs` and `dist/migrate.cjs`. It does not reinstall dependencies.

### Coordinated frontend/backend change

```bash
npm run build
npm run release -- full 20260927-full-01
npm run release:verify -- release/20260927-full-01
```

A full application package includes frontend and backend outputs, but intentionally excludes the runtime manifest and dependencies.

### Initial runtime setup or dependency change

```bash
npm run release -- runtime 20260927-runtime-01
npm run release:verify -- release/20260927-runtime-01
```

The runtime payload contains only `package.json` and `package-lock.json`, mapped to the application root. The source repository's root manifests stay unchanged: `runtime/package*.json` are the manifests intended for the hosted application.

Do not install dependencies inside the repository's `runtime/` directory. For testing, use a separate temporary installation directory; source fingerprinting rejects a nested runtime dependency tree.

## Release directory and verification

```text
release/<release-id>/
  manifest.json
  payload/
    dist/...                  UI, server, or full release
    package*.json             Runtime release only
```

Each manifest contains file checksums, Git commit and dirty-worktree status, source fingerprints, API contract, required schema range, required Node major version, and a runtime fingerprint. Packaging rejects stale source/build combinations, changed generated files, and unexpected files in frontend output.

Build from a clean committed worktree for a traceable production release. Dirty-worktree packages are permitted for local testing and are explicitly marked; do not treat their commit ID alone as a complete source identifier.

An extracted source ZIP can also build/package releases, but Git commit/dirty fields will be `null` when metadata is unavailable. Source and output fingerprints remain enforced.

To compare a package to your recorded active application manifest:

```bash
npm run release:verify -- release/20260927-ui-01 /path/to/active.json
```

This checks payload hashes and, when an active manifest is supplied, API compatibility for partial releases, schema requirements for UI releases, and runtime fingerprint compatibility. It does not contact the server, check the actual database, enforce maintenance mode, verify backup existence, or verify a remote Node version.

The API contract is manually maintained in `shared/release-contract.ts`; bump it for incompatible interface changes. A successful verifier run cannot discover a forgotten contract bump.

## Transfer and activation

Use rsync over SSH, SFTP, or another trusted transfer method to copy the selected payload into a private staging directory such as `.deploy/incoming/<release-id>`. Upload only the curated payload, not the source checkout.

Do not copy the staging folder itself into `dist/public`. The paths inside `payload/` are relative to the application root.

Before activation, verify transferred checksums against the manifest using trusted local/remote checksum tools or a downloaded copy and `release:verify`. Checksums detect transfer mistakes; they do not authenticate a maliciously replaced manifest, so use a trusted transport and manifest.

- **UI-only:** Copy new hashed assets before publishing HTML. Keep old hashed assets for at least two successful releases and seven days initially; then remove only assets unreferenced by retained releases. Publish HTML last, using a same-filesystem rename. Version changed non-hashed assets where possible. Normally no Node restart is necessary.
- **Backend-only:** Stop the managed app, retain the previous bundle, promote the staged backend files, restart through cPanel, and check the API. Use a brief maintenance window.
- **Schema release:** Follow the migration procedure below before starting the matching backend.
- **Runtime release:** Follow the separate runtime procedure below. Do not activate a backend requiring the new runtime until installation and smoke testing pass.

After a successful application activation, retain its manifest as `.deploy/active.json` and preserve the prior release metadata and files for rollback. Keep a separate `.deploy/runtime.json` for the actually installed runtime; do not mark a runtime package active merely because its files were uploaded.

The first deployment has no reliable `active.json`. Establish it only after checking the actual runtime, database, and installed application. Do not substitute a candidate release manifest as evidence of deployed compatibility.

Never use a broad `--delete` against the application root or `dist/public`. Never upload local `.env`, `data/`, `private/`, `node_modules/`, SQLite sidecars, backups, or host-generated `.htaccess`.

## One-time runtime transition on Dathorn

The existing hosted source manifest may include many development packages. Transition separately from routine application releases:

1. Take an application/configuration backup and schedule maintenance.
2. Inspect the hosting-managed Node environment and `node_modules` symlink. Preserve them; do not replace the symlink with a directory or upload your Mac's `node_modules`.
3. Stage the new full application release and runtime release.
4. Stop the application through cPanel.
5. Save the previous root `package.json` and lockfile privately, then replace them with the runtime payload.
6. Activate the exact Node environment command supplied by cPanel and work from the application root.
7. Run the runtime installation and in-memory test:

```bash
npm ci --omit=dev --no-audit --no-fund
npm run runtime:check
```

This installs only the runtime dependency tree. It may use a compatible native prebuild or compile SQLite on Dathorn; compiler availability and hosting restrictions have not been verified on the account.

If `npm ci` conflicts with CloudLinux's managed dependency symlink, stop and use Dathorn's supported locked installation procedure with support guidance. Do not remove the symlink or force the command. Test the host procedure before relying on it for routine maintenance.

After the runtime test succeeds, activate the compiled files, check/migrate the schema as needed, and restart through cPanel. Do not launch a second process with `npm start` alongside the panel-managed service.

Normal UI/API/schema releases skip dependency installation entirely when the recorded runtime fingerprint is unchanged. Changing the runtime lockfile, native driver, Node major version, or server platform requires a new runtime compatibility check.

## Explicit database commands

Run commands from the application root with the correct `DB_PATH` environment setting. They also load the root `.env`; never place that file under the document root.

### Read-only compatibility status

```bash
node dist/migrate.cjs --status
```

Returns JSON with `exists`, `version`, `required`, and `compatible`. Exit code is `0` for a compatible schema, `2` for missing/incompatible schema, and `1` for command/storage errors. This does not initialize a database or create an owner code.

### Intentionally create a new database

```bash
node dist/migrate.cjs --apply --init
```

Use only for a genuinely fresh database, never to repair a login or routing problem. Initialization creates tables and sets schema version 3, but does not create users, settings rows, bootstrap credentials, or start the server. Normal startup creates default settings and first-owner setup only after schema compatibility passes.

### Upgrade an existing database

1. Stop all application processes and other writers using this database.
2. Take a consistent backup, including any remaining WAL/SHM sidecars if copying a stopped database. Keep it outside the public directory and confirm restoration is possible.
3. Use the staged migration bundle built with the intended application release. Its filename may remain under private staging until activation; keep the working directory at the application root so relative private paths and `.env` resolve correctly.
4. Run:

```bash
node dist/migrate.cjs --apply --backup-confirmed
```

The example assumes the migration bundle has already been promoted while the app is stopped. If it remains staged, use its corresponding private staging path instead.

`--backup-confirmed` is an operator acknowledgment, not an automatic backup, proof of a backup, or enforcement that the app is stopped. The SQLite transaction serializes migration writers, but it does not replace an operational maintenance window.

5. Recheck `--status`, activate the compatible backend/frontend, restart, and verify authentication and booking data.

Legacy versions 0, 1, and 2 are upgraded through the version-three baseline and attendance backfill in one transaction. Unrecognized databases, future versions, incompatible structures, and detected foreign-key violations are rejected. Failed DDL/backfill operations roll back together. A compatible version-three database needs no upgrade and returns `changed: false`.

Schema version 3 remains the current application requirement; introducing explicit migrations does not itself require changing the data model. Startup rejects incompatible schema rather than repairing it. The former `db:push` npm shortcut has been removed to prevent confusion with the controlled migration process.

## Future schema changes and rollback

Do not edit the frozen `server/migrations/schema-v3.ts` baseline. Add a reviewed migration and explicit version transition, update startup compatibility validation and `shared/release-contract.ts`, and test old-to-new conversion, repeat application, failure rollback, and preserved security/member data.

Application rollback restores retained files only if they remain compatible with the active database and native runtime. A JavaScript rollback does not undo a database migration. Prefer a tested forward repair; restoring a backup needs explicit approval because it can discard later member activity.

## Production checks and limits

- Confirm `/api/auth/status` returns application JSON, not a web-server 404.
- Check the homepage, member login, owner setup when genuinely fresh, and affected member workflows.
- Confirm an anonymous member API request returns 401 and private files cannot be downloaded.
- Preserve `.htaccess`, `.env`, private paths, accounts and invitations throughout.
- Confirm restart preserves accounts, partnerships and attendance.
- Retain the previous application release and consistent pre-migration backup.

No rsync upload/activation script, GitHub Actions workflow, remote restart automation, zero-downtime guarantee, or Dathorn production migration is included. The site's visual design and member workflows are unchanged. This release does not itself resolve or certify the existing Dathorn routing configuration.
