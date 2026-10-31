# CABC About-page version diagnostics

About now shows the release identifier embedded in the loaded frontend, the
identifier loaded by the backend module, and the time that backend module
started (ISO UTC, with `Z`). The page is public; no sign-in is needed.
An older backend that cannot report a version is labelled explicitly, and
different identifiers produce a deployment-mismatch warning.
This release reports **1.0.1+8cffa1806ab4** for both frontend and backend.

## Deploy this update

No database migration, new dependency installation or frontend build is needed
for this change. Keep your production database and private mail settings.
While the application is stopped, upload:

| Repository file | Production destination |
| --- | --- |
| `server.mjs` | `/home/cabc/src/cabc-minimal/server.mjs` |
| `release.mjs` | `/home/cabc/src/cabc-minimal/release.mjs` |
| `public/app.js` | `/home/cabc/public_html/app.js` |
| `public/style.css` | `/home/cabc/public_html/style.css` |

Upload all four from the same release, then start the application and open
About. The new private `release.mjs` is required by `server.mjs`; do not restart
mid-upload. Keep `app.cjs`, `.htaccess`, the public symlink, `PUBLIC_DIR`,
`DB_PATH` and `EMAIL_ENABLED` unchanged.

You can also open the public endpoint directly:

```text
https://cabc.club/api/version
```

It returns only `version` and `startedAt`, with `Cache-Control: no-store`.
Unlike `/api/calendar`, it does not need an Authorization header. It exposes
no process ID, filesystem path, member data, credentials or database details.
The same release identifier is also included in `/api/config`.

## Read the result

- **Versions match:** The loaded frontend and backend report the same release.
- **Versions differ:** A partial deployment, older running backend or cached
  frontend may be involved. Compare against the release's `release.mjs`.
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

The command stamps both the frontend and backend from the package's numeric
version plus the first 12 digits of a SHA-256 source fingerprint. Any runtime
source/schema/package/public-asset change changes that fingerprint, even if the
numeric package version stays the same. Stamping twice without changes is
deterministic. Tests fail when source changes have not been stamped or the
frontend/backend identifiers disagree.

The release helper does not run on application startup or production deployment.
Tests, documentation, generated release metadata and host-specific
`public/config.js` are excluded from the runtime fingerprint. Private databases,
password files, queues and other operational data are never inputs.
After final changes, regenerate `SHA256SUMS` separately as usual.
