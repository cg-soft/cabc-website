# Chinese American Bridge Club

Editable website source with a public club website, invitation-only member hub,
and native Dance Cards partnership scheduler.

This handoff preserves the approved red, charcoal, and warm-white design, the
club logo, and the red plastic duplicate-board image. It is a standalone source
package, not a link to the Perplexity preview.

## Start here

- **Run it locally:** Follow the commands below.
- **Build locally and deploy minimal releases to Dathorn:** Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Host it with a custom domain:** Read [HOSTING.md](HOSTING.md).
- **Understand and change it:** Read [SOURCE-MAP.md](SOURCE-MAP.md).
- **Check privacy and launch limitations:** Read [SECURITY.md](SECURITY.md).
- **Review image provenance:** Read [ASSETS.md](ASSETS.md).
- **Review handoff checks:** Read [VERIFICATION.md](VERIFICATION.md).

## What is included

- Public Home, Our Club, Games & Events, and Contact pages.
- An invite-only member hub with real server-side authentication.
- Announcements, unified date-level RSVPs, opt-in directory, profile settings, and private
  plain-text document downloads.
- Administrator tools for member invitations, recovery codes, games,
  announcements, documents, club settings, and contact inquiries.
- Games & Dance Cards: a compact table with one row per date, integrated RSVPs,
  available-partner dropdowns, reciprocal bookings, and a full playing-pairs
  lineup for each date. Includes standby, member cards and Monday scheduling.
- Editable React/TypeScript frontend, Express backend, SQLite schema,
  automated tests, current image assets, and dependency lockfile.

## What is deliberately excluded

This package contains **no member database, existing accounts, real passwords,
active invitation/recovery/setup codes, private backups, Google credentials,
session tokens, or preview access credentials**. Test code contains clearly
synthetic credentials for isolated tests only.

For a new installation, explicitly initialize a fresh database. It does not import, synchronize with, or modify
the Google Sheets Dance Cards workbook. The current preview's data remains
separate from this package.

There is no generated `dist/` or `node_modules/` folder in the ZIP: install and
build them using the commands below. Historical asset-generation scripts,
operator-only notes, and Git history are also omitted.

## Local quick start

Use a Linux or macOS terminal, or Linux through WSL on Windows. The npm scripts
use Unix-style environment-variable syntax. Use Node.js 22 (22.12 or later) and
npm; see VERIFICATION.md for the exact version tested.

After extracting the ZIP:

```bash
cd chinese-american-bridge-club-source
npm ci --include=dev
cp .env.example .env
npm run migrate -- --apply --init
npm run dev
```

Open `http://localhost:5000`. Run all commands from the extracted project root.
The migration command creates `data/club.sqlite`. After verifying the schema,
the server creates a random owner setup code in `private/owner-setup.txt`.
Those paths are local defaults, not public URLs. Startup never creates or
upgrades the database schema.

### Updating an earlier downloaded package

For Dathorn, use the minimal runtime transition and explicit migration
instructions in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), not a full-project
dependency install on the host. The commands below are for a development
checkout. Stop the application and back up an existing database before
running `npm run migrate -- --apply --backup-confirmed`; do not use `--init`
for an existing member database.

The revised package pins `esbuild` to `0.28.2` and uses an npm override so
Drizzle Kit, Vite, tsx and the build script resolve to the same version. Its
`package-lock.json` has been regenerated and verified with a clean install.
The archive also restores the previously omitted `tailwind.config.ts`.

For an existing installation, replace **both `package.json` and
`package-lock.json` together**, and copy `tailwind.config.ts` from this package
into the project root. Then run:

```bash
npm ci --include=dev
npm run check
npm run build
```

Keep your existing `.env`, `data/` and `private/` directories. Do not delete
your database, setup files or the supplied lockfile. No `--force` or
`--legacy-peer-deps` option is needed for the verified installation.
Restart the application after rebuilding when you are ready to use the update.

### Create the first administrator

1. Start the site on your own machine, or complete the production hosting setup.
2. Read `private/owner-setup.txt` privately on the server. In production, use the
   path configured by `SETUP_PATH`.
3. Open **Member sign in → Club administrator? Complete first-time setup**.
4. Enter that setup code, your name, email, and a unique password of at least
   12 characters.
5. The first account becomes the administrator. The code is consumed once and
   the file is redacted after successful setup.

Do not send the setup file to members, upload it publicly, or save its contents
in a repository or support screenshot. There is no default administrator
password in this package.

### Configure the club

- Under **Club administration → Club details**, set the about text, venue,
  contact email, and schedule note.
- Add games under **Club administration → Add a game**.
- Create email-bound invitations and deliver the codes privately to members.
- Open **Games & Dance Cards → Add dates** to add Monday dates. Members must join the
  Dance Cards roster before they can be selected as partners.

### RSVP and partnership workflow

- Each San Francisco date has one table row. Members can RSVP “Playing” or
  “Not playing,” even without joining the partner roster.
- Booking an agreed partnership marks both members as playing automatically.
- Available partners are opted-in members who are unpaired and not marked
  “Not playing.” An unanswered RSVP is selectable, but does not count as
  attending until the member RSVPs, joins standby or is booked.
- “Cancel pair” keeps both players' RSVPs. Changing a paired RSVP to
  “Not playing” requires confirmation, cancels both partnership entries and
  keeps the former partner marked as playing.
- “View pairs” shows all pairs for that date exactly once, plus game details,
  attendance count, standby and unpaired roster members.
- Inside “View pairs,” choose **Print pair list** for a clean, numbered printout
  of the selected date. The browser can print it or save it as PDF. Longer
  lists repeat date/column headers; standby and unpaired members are included.
  Pair numbers are list references, not seating assignments. Printing does not
  create a public URL or upload member names.
- Calendar listings on the same date are grouped without deleting their
  individual details. The date-level RSVP applies to all of those listings.
- The explicit version-three migration preserves existing events and
  partnerships and imports their RSVP state into the unified schedule.
  Back up an existing installation before upgrading.

Contact messages are saved to the administrator's inbox in the app. The site
does not send email. Invitations and recovery codes require manual delivery.
Refreshing a page signs the member out because authentication tokens are held
only in memory.

### Club information still to confirm

The supplied launch contact is Gail Gabiati, with the address
24 Santa Ana Ave, San Francisco, CA 94127. The supplied regular schedule is
Monday at 11:30 a.m. San Francisco time.

The public settings are not prefilled with that address because its use as the
game venue, mailing address, or both has not been confirmed. No public email,
phone number has been selected. The intended site is `bridge.cabc.club`; confirm those details before
launch. The Dance Cards interface uses the Monday 11:30 a.m. schedule.

## Test and build

```bash
npm run check
npm test
npm run build
npm run migrate -- --status
npm start
```

- `check` runs TypeScript checking on app and build/release code.
- `test` uses isolated temporary databases, not the club database. The original
  backend suite uses port 5001, so keep that port free.
- `build` generates `dist/public/`, `dist/index.cjs`, and `dist/migrate.cjs`.
- `build:ui` and `build:server` independently rebuild their outputs.
- `test:release` tests split builds and the minimal compiled runtime in isolation.
- `release` packages a UI, server, full application, or runtime-only payload.
- `migrate` is the explicit initialization/upgrade/status command.
- `start` runs the production server on port 5000 by default.

Stop `npm run dev` before `npm start` if they would use the same port.

## Readable source

The source is formatted with Prettier and has descriptive module and function
names. Generated production bundles may be minified; edit the source instead.

```bash
npm run format
npm run format:check
```

Source changes belong in `client/`, `server/`, and `shared/`. Do not edit
`dist/`, which is regenerated by the build.

## Important hosting requirement

**This is a full-stack Node.js application, not a static-only website.** Member
login and all member data require the backend and a persistent private SQLite
database. See HOSTING.md before putting it online.

The app can be run and tested as delivered, but external production launch still
requires the hardening and operational checks in SECURITY.md. No hosting
subscription, domain purchase, production deployment, or live data migration
has been performed as part of packaging.
