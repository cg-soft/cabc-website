# CABC: Remember this device for 30 days

The login form now has an optional, unchecked **Remember this device for 30 days**
checkbox. Select it only on a personal device. This release is
`1.0.1+f1edbdc6b426`; the production upload is still the owner's step.
The personal-device note now sits directly beneath the option's title, with
both lines aligned beside the checkbox on desktop and phone layouts.

## Member behavior

- **Checked:** Signing in sets a secure remembered session for 30 days from
  sign-in. Reloading or reopening the same browser/web app restores the member
  without a password prompt while that session remains valid. It does not
  extend the original expiry.
- **Unchecked:** Ordinary sign-in keeps the existing 12-hour server session and
  memory-only bearer token. A full reload requires signing in again.
- **Log out:** Revokes this browser's session and removes its remembered cookie.
  A failed/offline logout reports an error rather than claiming it has signed
  out while a valid cookie remains.
- **Password change/reset or deactivation:** Revokes all sessions for the account,
  including remembered devices. Other remembered devices discover the revocation
  when they next contact the server.
- **Administrators:** Restored sessions start at Myself, never at a previously
  selected Acting for member. Account controls still belong to the actual admin.

Deleting website data, private browsing, a different browser, or a separate
web-app storage context can require another sign-in. For the iPhone Home Screen
app, check the option when signing in inside that app; do not assume Safari and
the installed app share their sign-in state. Shared preview accounts deliberately
cannot enable remembered sign-in.

## Upload to the existing Dathorn installation

No migration, npm installation, build, new environment variable or cron change
is needed when upgrading from the preceding working release. Stop the managed
Node app and upload all four files from this same release:

| Repository file | Production destination |
| --- | --- |
| `server.mjs` | `/home/cabc/src/cabc-minimal/server.mjs` |
| `release.mjs` | `/home/cabc/src/cabc-minimal/release.mjs` |
| `public/app.js` | `/home/cabc/public_html/app.js` |
| `public/style.css` | `/home/cabc/public_html/style.css` |

Keep `app.cjs`, `.htaccess`, the application's `public` symlink, `PUBLIC_DIR`,
`DB_PATH`, SMTP settings, dependencies and the working mail cron unchanged.
The live database remains `/home/cabc/src/cabc-minimal/private/cabc-minimal`;
do not initialize or replace it. Start the app only after completing all uploads.

If the preceding remembered-sign-in release is already installed, `server.mjs`
has not changed: this layout-only correction needs `release.mjs`, `public/app.js`
and `public/style.css`. Upload all three together and restart to load the new
backend version stamp.

Open About and confirm both versions are `1.0.1+f1edbdc6b426`, with a new backend
start time. If older workers survive the usual Stop/Start, stop the app, then
terminate only currently running application workers:

```sh
for pid in $(pgrep -u "$(id -u)" lsnode); do
  if [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "/home/cabc/src/cabc-minimal" ]; then
    echo "Stopping application worker $pid"
    kill -TERM "$pid"
  fi
done
```

Start the app again. Never reuse an old PID or broadly kill unrelated processes.
If versions still differ, check the uploaded files and reload the browser before
diagnosing authentication.

## Production acceptance

1. Open `https://cabc.club/#login`. The unchecked checkbox should be enabled.
   If it says the server needs updating, check About and restart stale workers.
2. Check the option and sign in. Reload, then close and reopen that browser.
   Verify the correct member returns without entering a password.
3. As an administrator, choose another member in Acting for, then reload.
   Confirm it returns to Myself.
4. Log out, reload and verify the login form returns. Sign in without the
   checkbox, reload, and verify sign-in is required again.
5. In the installed iPhone app, sign in there with the option checked, close
   and reopen it, then repeat logout. Actual iPhone/Safari behavior is a
   host/device acceptance check, not verified by the sandbox Chromium tests.

## Implementation and privacy

Only a random session credential is persisted in a host-only
`__Host-cabc_session` cookie with `Secure`, `HttpOnly`, `Path=/`,
`SameSite=Strict` and a 30-day `Max-Age`. Those attributes follow the
[MDN Set-Cookie requirements](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
The server stores only its hash in the existing sessions table and enforces
the absolute expiry. The password and raw remembered credential are not returned
in remembered-login JSON or saved in browser JavaScript storage.

Cookie-authenticated writes also require a session-bound CSRF token and reject
cross-site fetches. Normal bearer sessions remain supported; an explicitly invalid
bearer never falls back to a cookie. Protected responses remain uncached.
No service worker, offline calendar, queued action, third-party login, device
management page or revoke-other-devices control was added.

The sandbox passed all 274 automated tests on Node 22.23.2 and 24.22.2. Fifteen
new tests cover remember/default login, expiry, revocation, CSRF, account switching,
preview restrictions, restoration races and the helper's nested text column.
Browser checks used fictional data
on an isolated HTTPS server, never production accounts or SMTP.
