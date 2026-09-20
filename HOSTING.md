# Hosting instructions

## Recommended deployment shape

Run one long-lived Node.js service serving both the website and API, with one
private persistent disk for SQLite. Use HTTPS at the hosting provider's edge
and a custom domain owned by the club.

Do not upload this source folder as a public static directory. Express must
serve only the generated `dist/public` folder; the process also needs
`dist/index.cjs`, production dependencies and private database storage.

A static-only deployment cannot run this app's login or database. The included
SQLite implementation is not configured for serverless functions or multiple
application replicas. A different deployment architecture requires adapting
storage, sessions and rate limiting first.

## Render example

Render supports deploying an Express application from a repository as a Node
web service; this guide supplies the commands specific to this project
([Render Express deployment](https://render.com/docs/deploy-node-express-app)).

### Prepare the repository

1. Extract the source ZIP locally and create a private Git repository.
2. Commit the source and lockfile. Keep `.gitignore` intact.
3. Do not commit `.env`, databases, backups, `private/`, setup codes or member
   exports. The source package has none of those runtime files.
4. Complete the security checklist in SECURITY.md before opening the site to
   operational membership use.

### Create the service

Create a Node web service connected to that repository, using these
application-specific settings:

| Setting               | Value                                                    |
| --------------------- | -------------------------------------------------------- |
| Service type          | Web service, not static site                             |
| Runtime               | Node.js 22, 22.12 or later                               |
| Build command         | `npm ci --include=dev && npm run check && npm run build` |
| Start command         | `npm start`                                              |
| Health-check path     | `/api/auth/status`                                       |
| Number of instances   | One                                                      |
| Persistent disk mount | `/var/club-storage`                                      |

Choose a service plan that supports attaching a persistent disk. On Render,
only files beneath the mount path persist, and a service with a disk is limited
to a single instance; the disk is available at runtime, not during builds or
pre-deploy commands
([Render persistent disks](https://render.com/docs/disks)).

Set environment variables in the hosting dashboard:

```text
NODE_ENV=production
DB_PATH=/var/club-storage/data/club.sqlite
SETUP_PATH=/var/club-storage/private/owner-setup.txt
```

Let Render supply `PORT`; the application reads it. Do not set `API_ONLY=1`,
which would disable serving the frontend. Do not place the database beneath
`dist/`, `client/`, `public/` or `node_modules/`; the app rejects those paths.

The server creates the private directories and initializes the blank database
at startup. It does not need access to a database during the build.

Deploying a Render service with an attached disk can briefly interrupt
availability because zero-downtime deploys are disabled for those services
([Render persistent disks](https://render.com/docs/disks)).

### Complete private owner setup

Use the hosting provider's trusted server console to read
`/var/club-storage/private/owner-setup.txt` privately. Then visit the HTTPS site
and complete the owner setup form described in README.md. Never paste the code
into a public issue, repository, shared log or screenshot.

If your selected hosting plan has no secure server-console access, arrange a
secure operator method for retrieving the initial setup file before deployment.
Do not add a public API endpoint to return the setup code.

### Add a custom domain

Add the desired domain in the service's Custom Domains settings, enter the DNS
records shown by Render at the registrar/DNS provider, and verify the domain
in Render
([Render custom domains](https://render.com/docs/custom-domains)).

Render documents automatic TLS certificate issuance/renewal and HTTP-to-HTTPS
redirects for verified custom domains
([Render custom domains](https://render.com/docs/custom-domains)).

Use the DNS values supplied for your actual service; do not copy a guessed
IP address or sample hostname. Review existing email-related DNS records
before making changes. Domain registration, DNS and a mailbox are separate
from this application's source package.

## Alternative: an existing Linux server

The same build/start commands work on a compatible Linux host:

```bash
npm ci --include=dev
npm run check
npm test
npm run build
```

Run the production process as a dedicated non-root user, with a private
persistent directory it can write:

```text
NODE_ENV=production
PORT=5000
DB_PATH=/var/lib/cabc/data/club.sqlite
SETUP_PATH=/var/lib/cabc/private/owner-setup.txt
```

Start `npm start` using a managed process supervisor. Set its working directory
to the project root and configure restart-on-failure. Terminate HTTPS at a
trusted reverse proxy and firewall the Node port from direct public access.
Do not enable development mode on the public host.

The current server intentionally does not trust forwarded IP headers. A reverse
proxy can therefore cause shared per-peer rate-limit buckets. Have the operator
configure a trusted edge limiter and review application proxy handling rather
than blindly enabling `trust proxy`.

## Backups and recovery

1. Back up the database using a SQLite-consistent backup procedure. For the
   simplest controlled backup, stop the app cleanly, then copy the database
   and any remaining WAL/SHM sidecars together.
2. Do not copy only a live `.sqlite` file while WAL writes may be in progress.
   Use the SQLite online backup API for online backups.
3. Store encrypted backups outside the service's disk with limited access.
4. Test restoration on a separate host and private database path.
5. Back up immediately before schema changes. Decide retention and backup
   frequency according to the club's tolerance for lost bookings.

Render's disk documentation distinguishes filesystem snapshots from
database-aware backups and warns against relying on snapshot restoration for
a custom database instance
([Render persistent disks](https://render.com/docs/disks)).

Do not delete a member database or reopen first-owner setup as a password-reset
method. See SECURITY.md for the single-administrator recovery limitation.

## Launch acceptance checklist

- [ ] Domain chosen, owned by the club and pointed to the correct service.
- [ ] HTTPS works with no mixed-content errors.
- [ ] Persistent disk and both private paths configured.
- [ ] Fresh owner setup completed through the private operator channel.
- [ ] Approved public contact information and game venue confirmed.
- [ ] Invitations and password recovery tested with disposable test accounts.
- [ ] A normal member cannot access administrator routes.
- [ ] Anonymous `/api/member/dance` returns 401.
- [ ] Private files and database URLs cannot be downloaded.
- [ ] Unified RSVP, partner availability, booking, cancellation and standby tested.
- [ ] “View pairs” shows the correct full lineup for a selected date.
- [ ] Before upgrading an existing installation, a consistent database backup
      is saved and the version-three migration is tested on a disposable copy.
- [ ] Server restart preserves accounts, events and partnerships.
- [ ] Backups, restore procedure, monitoring and operator access reviewed.
- [ ] CORS, proxy/rate limiting and other SECURITY.md blockers addressed.

The archive is a source handoff, not evidence that any of these external
hosting tasks have already been completed.
