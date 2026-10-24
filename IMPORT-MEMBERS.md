# Import club members from CSV

This is an operator-only command for loading members into the minimal CABC site.
It does not reset the database, create administrators, change existing passwords,
or replace existing accounts and registrations. **No real CSV has been imported
as part of adding this command.**

## Prepare a private CSV

Inactive accounts retain their email addresses. The importer will reject an
existing email, or skip it unchanged with `--skip-existing`; it never reactivates
an inactive member or resets their password.

Use a UTF-8 CSV with exactly these three headers:

```csv
name,email,initial-password
```

The repository's `examples/members-template.csv` contains the header only.
Copy it outside the repository before adding real details. Header order may vary;
capitalization and surrounding header whitespace are ignored. Standard quoted
fields, embedded commas and doubled quotes are supported.

- **Name:** 2–80 characters after trimming.
- **Email:** Valid email format, at most 180 characters. Trimmed and normalized
  to lowercase for matching and storage.
- **Initial password:** 12–128 characters. Kept exactly as provided, including
  leading/trailing spaces; do not add accidental spaces. Line breaks and NUL
  characters are rejected because the sign-in form cannot reliably enter them.
- **Roles:** Every imported account is a member. Extra columns, including `role`,
  are rejected; administrators are not assigned through the CSV.

Give each member a strong, unique initial password. Imported passwords are
hashed with the same salted scrypt mechanism as accounts created in the site.
Members can change their initial password after signing in, but the application
does not force an initial password change.

The real CSV contains plaintext credentials: never upload it into `public/`,
commit it to GitHub, or paste its contents into chat. Store it outside the
application directory, restrict it to mode 600 or stricter, and deliver initial
credentials privately. Importing does not send emails or messages.

## Dathorn commands

Upload `import-members.mjs` to `/home/cabc/src/cabc-minimal`. It imports the
existing `db.mjs`; no build, npm installation, app restart or schema migration is
needed for this command itself. Activate the Node environment shown in Dathorn.

Assuming the private CSV has been uploaded to
`/home/cabc/private/cabc-minimal/members.csv`:

```bash
cd /home/cabc/src/cabc-minimal
export DB_PATH=/home/cabc/private/cabc-minimal/club.sqlite
chmod 600 /home/cabc/private/cabc-minimal/members.csv

# Validate without creating or changing accounts:
node import-members.mjs /home/cabc/private/cabc-minimal/members.csv --dry-run
```

Review the counts and resolve any reported line errors. The command never prints
passwords or complete CSV rows. If this is a brand-new installation, first run
`node manage.mjs init` to create the schema and initial administrator; do not
rerun initialization or replace the database on an existing installation.

Make a verified database backup before applying. If the backup utility has
already been configured, use `node backup.mjs run`; otherwise follow
`BACKUPS.md` or arrange a consistent host backup. Then run:

```bash
node import-members.mjs /home/cabc/private/cabc-minimal/members.csv --apply
```

Without `--apply`, the default is always a dry run. The import validates the
entire CSV before writing, hashes new passwords before taking the database
write lock, rechecks account collisions under that lock, and inserts in a
single transaction. A validation or insertion failure leaves no partial import.
Counts of members, games, entries and sessions are shown before and after.
Only the member count increases; existing sessions and registrations remain.

For approximately 200 members, hashing may take a while. Let the command finish;
use a quiet period so the short final database write does not interfere with
club operations. The tool supports up to 5 MB and 5,000 nonblank member rows.

## Existing accounts and repeated imports

By default, an email already in the database rejects the entire import.
Duplicate emails within the CSV also reject the entire import, including
differences that are only capitalization or surrounding whitespace.

To add only new addresses and leave all existing records untouched:

```bash
node import-members.mjs /home/cabc/private/cabc-minimal/members.csv --dry-run --skip-existing
node import-members.mjs /home/cabc/private/cabc-minimal/members.csv --apply --skip-existing
```

`--skip-existing` never updates an existing name, password, role or session.
This also protects an administrator whose email appears in the CSV. All rows
must still pass validation, including skipped rows. Duplicate addresses inside
the CSV remain errors because their intended values are ambiguous.

## After importing

Confirm a member can sign in with their email and initial password and can use
Change password. Keep credential delivery private. Once verified and no longer
needed, remove the plaintext CSV from the server and any unneeded local copies;
ordinary deletion does not guarantee removal from provider snapshots or backups.

If the network disconnects during an import, do not assume failure or rerun
blindly. A new `--dry-run --skip-existing` reports which rows would still be
added. SQLite transactions prevent partial commits of one import operation.
The command does not offer a destructive “replace all” or bulk password-reset
mode.
