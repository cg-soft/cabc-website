# CABC Calendar on the iPhone Home Screen

For your split production layout, apply [the public-directory correction](SPLIT-PUBLIC-DIRECTORY.md):
application files remain in `~/src/cabc-minimal`, while `public/...` files go
directly into `~/public_html`. Set the managed process's `PUBLIC_DIR` to that
directory's absolute path and restart Node.

This release adds an online home-screen web app using the existing frontend
and server. It does not create an App Store application or change the
authentication model. Production deployment remains the owner's manual step;
the preview and GitHub updates do not change Dathorn.

## Install on an iPhone

After the owner deploys this release:

1. Open the [club website](https://cabc.club/) in Safari on the iPhone.
2. Open Share, then choose Add to Home Screen. Scroll through the actions if
   necessary.
3. If offered, turn on Open as Web App. Tap Add.
4. Open the new CABC Calendar icon and sign in when asked.

These steps follow [Apple's iPhone web-app instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
Install the real club website, not the embedded Perplexity preview.
The Login page and calendar footer also provide these instructions.

If an older club shortcut already exists, remove only that shortcut and add
the website again after deployment to pick up the icon and launch metadata.
There is no need to delete all Safari website data as a routine upgrade step.

## What changes

- The icon uses the existing club logo with an opaque background.
- The installed app launches toward the calendar. If no session is loaded,
  it shows sign-in instead of bypassing authentication.
- Normal Safari and desktop visits retain the public homepage.
- Standalone layouts account for the status bar, notch and home indicator.
- Install-help links are hidden inside the installed app.
- Returning to a loaded calendar or reconnecting refreshes its current month,
  selected game and administrator acting target, without replacing open forms
  or interrupting an in-flight scheduling request.
- An offline notice explains that a connection is required. Known-offline
  actions send no request. An ambiguous network error tells the member to
  refresh and check whether a save completed rather than claiming success or
  retrying a write automatically.

Apple documents icons and standalone configuration in
[Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).

## Sign-in, privacy and connection limits

The existing 12-hour server sessions and in-memory bearer tokens are unchanged.
Credentials and member/calendar data are not persisted in local storage,
IndexedDB, cookies or an application cache. A full reload, a fresh launch or
iOS discarding the app's process may require signing in again. Password fields
retain their password-manager autocomplete attributes.

An internet connection is required to launch, load or change the calendar.
There is deliberately no service worker, offline calendar copy, queued
registration or push notification. This is not an offline app. A cold launch
without a connection may show the browser's network error; the in-app offline
notice applies when the page is already loaded.

Static assets use Cache-Control: no-cache for revalidation. APIs use
Cache-Control: no-store, and frontend requests also request no-store.
No cache-busting query strings or versioned filenames have been introduced.

## Upgrade an existing installation

Prerequisite: the current administrator-scheduling release is installed and
working. Older installations must first follow their existing feature upgrade
instructions in HOSTING.md.

Back up the existing private database as usual, stop the application briefly,
and upload these nine runtime files to the existing Dathorn application/public
locations:

```text
server.mjs
public/index.html
public/app.js
public/style.css
public/web-app.js
public/manifest.webmanifest
public/apple-touch-icon.png
public/app-icon-192.png
public/app-icon-512.png
```

Preserve the existing production public/config.js, DB_PATH and database.
Do not upload the preview's inline API configuration or any preview database.
Do not run init, preview:seed or any migration for this release.
There are no new dependencies and no build step. The package.json change only
includes the new test suite; upload it with the tests if maintaining a complete
source checkout on the server.

Restart the application so its updated public-file allowlist takes effect.
Fully reload Safari and check the install-help link before creating the
home-screen icon. Uploading only the HTML is insufficient.

## Check the deployed files

After deployment, check the actual production responses:

```bash
curl -I https://cabc.club/manifest.webmanifest
curl -I https://cabc.club/web-app.js
curl -I https://cabc.club/apple-touch-icon.png
curl -I https://cabc.club/app-icon-192.png
curl -I https://cabc.club/app-icon-512.png
```

Expect HTTP 200, application/manifest+json for the manifest, text/javascript for
the helper, image/png for the icons, and Cache-Control: no-cache.
API responses should continue to use no-store.

If Dathorn serves physical public files directly rather than through Node,
verify that its static-file configuration supplies the correct manifest MIME
type and revalidation headers as well. Do not change unrelated routing or
hosting configuration without checking the current setup.

## Verify on the actual iPhone

- Add the site from Safari and confirm the club icon and CABC Calendar name,
  then launch without the normal Safari address bar.
- Sign in and check month navigation and the dance card.
- Check portrait/landscape, the keyboard and scrolling a dialog; the notch
  and home indicator must not cover controls.
- Using a disposable test game/account, register and cancel, choose a partner
  and wildcard, and exercise teams if applicable.
- For administrators, check the header Acting for alignment with Home/Log out.
- Open Export my games and check the iPhone's calendar-file handling.
- With the app open, disconnect networking, check the offline notice,
  reconnect and check the refreshed calendar.
- Log out and relaunch. Do not assume persistent authentication.

Automated tests and Chromium mobile/standalone/safe-area simulations are
recorded in QA.md. They do not certify the native iOS installation sheet or
physical-device Safari behavior.
