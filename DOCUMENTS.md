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
  Open launches the browser's PDF viewer in a new tab. If automatic popups are
  blocked, use Open PDF in the fallback dialog. Download saves the original
  filename. The hosted preview has an opaque security sandbox that blocks PDF
  tabs, so Open saves the PDF there instead, with an explanatory message. The
  normal application origin retains native viewing. No credential is put in a URL.

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

Update these seven application-directory files in
`/home/cabc/src/cabc-minimal/`:

- **server.mjs:** Authenticated document routes and PDF-viewer CSP support.
- **documents.mjs:** Access checks, bounded uploads, management and file delivery.
- **documents-schema.sql:** Additive documents and document_audit tables.
- **db.mjs:** Installs the optional schema only for genuinely new databases.
- **migrate.mjs:** Explicit documents migration for the existing live database.
- **package.json:** Documents migration and development-test scripts.
- **release.mjs:** Generated backend version.

Update two public files in `/home/cabc/public_html/`:

- **app.js:** Upload `public/app.js` as `app.js`.
- **style.css:** Upload `public/style.css` as `style.css`.

The source also includes document-tests.mjs and updated SHA256SUMS for development
and verification. No new npm dependency is required. Do not replace .htaccess,
the public symlink, private settings, the live database, or node_modules.

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
  the PDF new tab and popup fallback. Actual iPhone acceptance remains an owner
  check; browser automation covers Chromium at desktop and phone viewport sizes.
- **Backups:** Run the existing encrypted backup after a sample upload. A verified
  private restore copy contains the same PDFs and visibility; there is no separate
  file directory to restore.

This source and preview update does not change the live Dathorn installation.

## Release identification

Frontend `1.0.1+9c4cdeda5e88` expects backend `1.0.1+4512be8e64e2`.
All 309 development tests pass on Node 22.23.2 and 24.22.2. The hosted preview
was checked with fresh administrator/member sessions, including upload,
publish/restrict/delete, exact PDF downloads and a calendar registration cycle.
In-page viewing has been discussed as a possible follow-up; this release still
uses the normal browser PDF tab, or the explained sandbox download fallback.
