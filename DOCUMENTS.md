# CABC members-only documents: use and Dathorn upgrade

The signed-in calendar now has a Documents control. Administrators manage the
library; active members can open and download only documents shared with all
members. Public visitors and inactive accounts cannot list or retrieve files.

## Visibility and everyday use

- **Administrators only:** The default for every new upload. Only signed-in
  administrators can see its listing or retrieve its PDF.
- **All members:** Every signed-in active member, including administrators, can
  see and retrieve the PDF. An explicit sharing checkbox is required for a new
  all-member upload, a replacement all-member PDF, or an admin-only document
  being made available to all members.
- **Acting for:** Permissions always belong to the signed-in account. Acting for
  a regular member does not hide an administrator's documents or grant that
  member administrator access.
- **Manage documents:** Use Upload document for a title, optional description,
  visibility and PDF. Edit / replace changes metadata or optionally replaces the
  file. Leave Replacement PDF empty to keep the existing file. Delete requires
  confirmation. Stale edits are rejected rather than silently overwriting a
  newer administrator's change.
- **Open and Download:** Both fetch the file through authenticated API requests.
  Open displays the PDF inside the Documents page, not a popup, tab or automatic
  download. This also works in the hosted preview. Download saves the original
  filename. No credential is put in a URL.
- **Read a PDF:** Previous and Next move between pages; Page accepts a page
  number. Fit width follows the available screen width. Use 100%, 150% or 200%
  for a larger view and scroll inside the page. Back to documents returns to
  the library. The reader also has its own Download PDF control.
- **Page text:** Read page text expands an accessible, copyable text version of
  the current page. Its reading order follows the PDF's extracted content;
  image-only scans have no selectable text. This is not OCR.
- **Advanced PDF features:** The embedded reader displays pages, not native
  PDF forms, annotation links, scripts, attachments or interactive actions.
  Download the original for your preferred PDF reader when those tools are needed.

## Storage, limits and safety

PDFs are limited to 10 MiB each, 250 MiB of current PDF contents in total, and
1,000 current documents. Titles allow 120 characters and descriptions 1,000.
Other formats, conversion, document-specific member lists and upload-notification
emails are not included.

The implementation stores PDF bytes as SQLite BLOBs in the existing private
database, together with the document's metadata and visibility. This replaces the
earlier separate-directory proposal: no documents directory or DOCUMENTS_DIR
setting is required. Nothing is uploaded into public_html. Restrict the database
and its directory using the existing private-file protections.

The existing encrypted SQLite backup and verified restore-copy commands include
both PDF bytes and visibility in one consistent snapshot when they target the
same live database. No separate file-backup job or backup-code change is needed.
Verify the scheduled backup's actual DB_PATH: it must point to
`/home/cabc/src/cabc-minimal/private/cabc-minimal`, not the different database path
in older hosting examples. Correct the backup job if necessary; its live coverage
has not been verified here. Allow additional disk space for database growth and
retained backup copies. The logical 250 MiB quota is not a ceiling on the database
file or total backup size; SQLite may retain freed pages.

Every listing and file read checks the actual signed-in account and visibility.
File responses use private, no-store caching. Writes require administrator access,
and remembered-cookie writes retain CSRF protection. Uploads recheck the session
and administrator role after the body has arrived. Content, metadata and the
management audit record are saved atomically.

The embedded reader receives the authenticated bytes in memory. It does not put
PDFs in browser storage, a service worker, a public URL, or a third-party viewer.
Leaving Documents or signing out cancels the reader, clears its canvases and
extracted text, and destroys the parser. Late responses cannot reopen the reader.
The display uses one page at a time and bounds the canvas backing-store size.

PDF.js and its font/CMap/image-decoder resources are vendored locally in
`public/vendor/pdfjs-6.5.438/`, with their licenses. They are public program files,
not club documents. They load only when opening a PDF and require no CDN or
new production npm installation. The reader deliberately uses the in-process
worker so it works in opaque-origin previews, disables JavaScript evaluation and
WebAssembly, and uses the package's JavaScript image-decoder fallbacks.

Uploads are bounded and checked for PDF headers/endings, filenames and common
active-content markers. This is basic screening, not antivirus or complete PDF
sanitization; upload only trusted, vetted PDFs. Encrypted PDFs, detected scripts,
embedded files and automatic actions are rejected. No arbitrary HTML, scripts,
archives or executable uploads are supported.

Visibility changes stop future server retrieval; they cannot recall already
opened or downloaded copies. Deletion is not secure erasure and does not remove
earlier backup copies. Private document titles and contents should never be
uploaded to the shared fictional preview.

## Files to deploy

For the complete Documents feature, update these eight application-directory files in
`/home/cabc/src/cabc-minimal/`:

- **server.mjs:** Authenticated document routes, exact viewer-asset allowlisting
  and module/binary MIME handling.
- **pdf-assets.mjs:** Generated allowlist of the vendored public PDF.js resources.
- **documents.mjs:** Access checks, bounded uploads, management and file delivery.
- **documents-schema.sql:** Additive documents and document_audit tables.
- **db.mjs:** Installs the optional schema only for genuinely new databases.
- **migrate.mjs:** Explicit documents migration for the existing live database.
- **package.json:** Documents migration and development-test scripts.
- **release.mjs:** Generated backend version.

Update these three public files and the complete vendor directory in
`/home/cabc/public_html/`:

- **app.js:** Upload `public/app.js` as `app.js`.
- **style.css:** Upload `public/style.css` as `style.css`.
- **pdf-viewer.mjs:** Upload `public/pdf-viewer.mjs` as `pdf-viewer.mjs`.
- **vendor/pdfjs-6.5.438/:** Upload this entire directory from `public/vendor/`,
  retaining all subdirectories, decoder files, fonts, CMaps and licenses.
  The final path is `/home/cabc/public_html/vendor/pdfjs-6.5.438/`,
  not `/home/cabc/public_html/public/vendor/`.

The source also includes document-tests.mjs, pdf-viewer-tests.mjs, a development-only
vendor-copy script, and updated SHA256SUMS for development and verification.
No new production npm dependency is required. Do not replace .htaccess,
the public symlink, private settings, the live database, or node_modules.

### Viewer-only upgrade from the previous Documents release

If private Documents is already installed, upload only `server.mjs`,
`pdf-assets.mjs`, `release.mjs` and the updated `package.json` in the application
directory, plus the three public files and vendor directory above.
Restart the backend once so its new static allowlist takes effect, then fully
reload the browser. No database migration is needed for this viewer-only change.
The existing Documents tables, PDFs and visibility stay unchanged.

This is not a frontend-only upgrade: an old running server refuses the new
viewer assets. After this upgrade, later changes confined to already-allowlisted
public files retain the normal no-restart behavior.

## Safe production upgrade

Run your existing verified backup command first, explicitly targeting the live
database above and retaining your private backup-key settings. Confirm a
successful encrypted backup before proceeding.
Then stop the application in the hosting panel, upload the files above, and run:

```sh
DB_PATH=/home/cabc/src/cabc-minimal/private/cabc-minimal \
  /opt/alt/alt-nodejs24/root/usr/bin/node \
  /home/cabc/src/cabc-minimal/migrate.mjs documents
```

This is the existing live database file without an extension. Do not substitute
the unused separate club.sqlite path and do not initialize a replacement.

The migration adds two tables and a metadata migration marker, keeps
PRAGMA user_version at 1, and compares before/after counts for the existing
non-metadata tables. No existing registration, member or session rows are
rewritten. It is safe to repeat the command.

Start the application again and fully reload the browser. Check Website version
on About: the backend must match Expected backend. If an old LiteSpeed worker
survives the panel restart, stop only verified application workers using the
previous stale-worker procedure, then start the application again.

Check that `/pdf-viewer.mjs` and
`/vendor/pdfjs-6.5.438/pdf.min.mjs` return 200 with a JavaScript content type
(`text/javascript` or `application/javascript`), not HTML or an attachment.
The Node server supplies the correct types. If LiteSpeed serves those files
directly, verify its `.mjs` MIME mapping in the hosting panel before acceptance;
do not replace your working routing rules. A missing file or wrong module MIME
type leaves an in-page error with Back to documents and Download PDF available.

No SMTP, mail-cron, PUBLIC_DIR, remember-device or database-path setting changes
are required. Do not enable PREVIEW_MODE on production.

## Acceptance checks

- **Administrator:** Upload a small trusted PDF with default visibility; verify
  that its badge says Administrators only. Open and download it.
- **Regular member:** Sign in separately and confirm that the private document
  does not appear. A copied protected file endpoint must not retrieve its bytes.
- **Sharing:** Change visibility to All members and confirm sharing. Refresh the
  member's Documents page; verify opening and downloading.
- **Restriction:** Switch back to Administrators only. Confirm future member
  retrieval is denied; already downloaded copies naturally remain.
- **Management:** Edit a title, replace a PDF, cancel deletion, then confirm
  deletion of a disposable document.
- **Devices:** Check desktop Chrome and iPhone Safari/home-screen mode, including
  an actual rendered PDF without popups or an automatic download. Exercise a
  multipage PDF, Page entry, Previous/Next bounds, zoom, fit-width after rotation,
  Read page text, Back to documents, and exact original downloads.
  Check leaving/signing out during loading and reopening after an error.
  Actual iPhone acceptance remains an owner check; browser automation covers
  Chromium at desktop and phone viewport sizes.
- **Backups:** Run the existing encrypted backup after a sample upload. A verified
  private restore copy contains the same PDFs and visibility; there is no separate
  file directory to restore.

This source and preview update does not change the live Dathorn installation.

## Release identification

See the current frontend and expected-backend stamps in `public/app.js`, the
backend stamp in `release.mjs`, and the current verification record in `QA.md`.
The in-page reader replaces the previous native-tab/sandbox-download Open
behavior; Download remains an explicit separate action.
