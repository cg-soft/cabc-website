# CABC split-directory hosting correction

The application can now use your existing layout without moving public files:

- Application code: `~/src/cabc-minimal`
- Public HTML, JavaScript, styles and images: `~/public_html`
- Database: keep its current private location and `DB_PATH` unchanged.

## Apply the correction

1. Upload the updated `server.mjs` into `~/src/cabc-minimal/server.mjs`.
2. In the Node application manager, add an environment variable named
   `PUBLIC_DIR`, containing the absolute path to your public directory.
   For example: `/home/ACCOUNT/public_html`, replacing `ACCOUNT` with your
   actual hosting account directory.
3. Save the environment setting and restart the managed Node application.

To find the exact value in your hosting terminal, run:

```sh
printf '%s\n' "$HOME/public_html"
```

Copy that command's output into the control-panel value. Do not enter
`~/public_html` or `$HOME/public_html` literally there. Shell shortcuts are
not expanded by Node, and an SSH `export` does not configure the separately
managed web process.

No migration, database change, frontend upload, build or new dependency is
needed for this correction. Keep the existing `app.cjs` startup file, private
configuration, `config.js` and host-generated `.htaccess`.

## Future public-file updates

Source-package paths starting with `public/` go directly inside
`~/public_html`. For example, upload `public/app.js` as
`~/public_html/app.js`, not `~/public_html/public/app.js`.
Keep all private application files outside `public_html`.

Without `PUBLIC_DIR`, the default remains `<application directory>/public`.
The server only serves its existing explicit list of public assets; choosing
a directory does not expose every file inside it. Missing assets do not fall
back to old copies in the application's bundled public directory.

## Verify and distinguish hosting errors

Check the homepage, Login and calendar after restarting. These public files
should return 200 and their correct content types:

```sh
curl -I https://cabc.club/app.js
curl -I https://cabc.club/config.js
curl -I https://cabc.club/style.css
curl -I https://cabc.club/manifest.webmanifest
```

The path correction fixes where Node reads public files. LiteSpeed may serve
physical files directly before Node sees the request, so it cannot fix a
LiteSpeed-generated 403. If the files remain forbidden, ask Dathorn to inspect
the error log, ownership, symlink restrictions and access rules. Do not use
`chmod 777`, disable security rules indiscriminately, or move the database into
the web root. See [hosting instructions](HOSTING.md) for the complete deployment
and security checks.
