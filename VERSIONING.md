# CABC About-page version diagnostics

Frontend and backend now have independent version stamps. About keeps its
supplied club text and collapsed **Website version** disclosure, which shows:

- **Frontend:** The loaded website's public-assets version.
- **Backend:** The version loaded by the running Node worker.
- **Expected backend:** The backend stamp embedded in this frontend release.
- **Backend started:** The worker's module-initialization time (ISO UTC).

Different frontend and backend stamps are normal. About checks whether the
running backend equals Expected backend, not whether its stamp equals Frontend.
This preserves a useful stale-worker or partial-deployment warning without
requiring a backend restart for a website-only edit.

Current frontend: **1.0.1+469426ea5f1d**.
Current backend and expected backend: **1.0.1+1813e9585361**.

## One-time transition

This transition changes the meaning of the backend stamp, so it requires one
restart. Stop the managed app and upload these two files from the same release:

| Repository file | Production destination |
| --- | --- |
| `release.mjs` | `/home/cabc/src/cabc-minimal/release.mjs` |
| `public/app.js` | `/home/cabc/public_html/app.js` |

Start the app, open About and expand Website version. Frontend should show
`1.0.1+469426ea5f1d`; Backend and Expected backend should both show
`1.0.1+1813e9585361`, with “Backend matches the version expected by this frontend.”

This assumes the preceding About/remembered-sign-in releases are installed.
There is no server.mjs, CSS, migration, dependency, environment-variable, SMTP
or cron change. Keep app.cjs, .htaccess, the public symlink, PUBLIC_DIR and the
live DB_PATH unchanged. The release-generation helper is a development tool;
it is not required by the production Node process.

## Future website-only updates

After editing only files under `public/`, run the release command in the
development checkout as usual. Upload the changed public files to
`/home/cabc/public_html`, including the newly stamped `app.js`.

- **Text/JavaScript change:** Usually upload only `public/app.js`.
- **CSS/image/HTML/icon change:** Upload those changed assets plus `public/app.js`,
  because it carries the new frontend stamp.
- **Do not upload release.mjs or stop/restart Node:** The backend metadata is
  unchanged, including its modification time.
- **Reload the browser:** Existing tabs do not replace their loaded JavaScript
  automatically. The new frontend stamp should appear, while Backend and
  Backend started remain unchanged and the expectation check succeeds.

For shared-host caches, check the loaded frontend stamp before troubleshooting
the backend. Refreshing static assets is separate from restarting Node; this
change does not add an offline cache or automatic client updates.

## Backend changes

Upload the changed private application files, the newly stamped `release.mjs`
and matching `public/app.js`, then restart Node. The app.js upload carries the
new expected-backend marker even if its frontend version itself is unchanged.
Package/runtime/schema changes conservatively count as backend changes; any
required database migration remains a separate, explicit operator action.

You can also open the public endpoint directly:

```text
https://cabc.club/api/version
```

It returns only `version` and `startedAt`, with `Cache-Control: no-store`.
Unlike `/api/calendar`, it does not need an Authorization header. It exposes
no process ID, filesystem path, member data, credentials or database details.
The same backend identifier is also included in `/api/config`; the API shape
is unchanged, so existing clients and mail workers continue to work.

## Read the result

- **Backend matches expected:** The running backend agrees with the frontend's
  expectation, even when Frontend has a different hash.
- **Backend differs from expected:** A partial deployment, older running worker
  or cached frontend may be involved. Compare against the release's `release.mjs`
  and the Expected backend field; different component hashes alone are normal.
- **Backend not reported:** An older backend may still be serving requests.
- **Backend unavailable:** The version request failed; the frontend identifier
  remains visible. This is not proof that a particular server version is running.
- **Backend started:** Check whether it changes after a real process restart.
  It reflects module initialization, not a file's modification time.

Identifiers are release labels, not a guarantee that every individual deployed
file is intact. Do not assume a version mismatch alone identifies its cause.
No versioned asset URLs, query-string cache busters, service worker or offline
cache were added.

## Refresh the version on every application change

In the development checkout, after editing application code/assets and before
the final tests and commit, run:

```sh
npm run release:version
npm test
```

The command prints separate frontend and backend versions, each using the
numeric package version plus the first 12 digits of its SHA-256 fingerprint.
The frontend fingerprint covers public assets, normalizing both generated
version markers. The backend fingerprint covers private application/runtime,
schema and package inputs, not public assets. Both remain deterministic.
Tests fail when either source scope is unstamped or the embedded expected
backend is incorrect. Generated files are written only when their bytes change.

The release helper does not run on application startup or production deployment.
Tests, documentation, the release-generation helper, generated metadata and host-specific
`public/config.js` are excluded from the runtime fingerprint. Private databases,
password files, queues and other operational data are never inputs.
After final changes, regenerate `SHA256SUMS` separately as usual.
