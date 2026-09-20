# Security and operational limitations

## Existing safeguards

- Invitations are required for membership; the first administrator requires a
  one-time random setup code.
- Passwords use salted scrypt hashes. Session secrets are random and stored
  hashed in SQLite, with an eight-hour expiry.
- Browser tokens are kept in memory, not cookies or browser storage. Reloading
  signs the member out. The backend checks authorization on each private route.
- Administrator routes have a separate role check.
- Private database and setup paths are blocked from HTTP serving.
- JSON input is size-limited and validated with strict input allowlists.
- Invitations last seven days; manually generated recovery codes last one hour.
  Password reset revokes existing sessions.
- Directory and Dance Cards membership have separate opt-in controls.
- Reciprocal dance-card writes are transactional and reject conflicts.

## Before operational production launch

This is tested application code, not a guarantee of production security.
Assign a technical operator to complete these remaining items.

### Origin policy

The API still allows wildcard CORS without credentials, inherited from the
opaque-iframe preview. Bearer authentication remains mandatory, but the broad
origin policy should be restricted for standalone hosting.

There is currently no `ALLOWED_ORIGINS` environment-variable implementation.
Review and change the header middleware in `server/index.ts`, then update the
CORS test expectations. With the delivered same-origin frontend, broad
cross-origin access is not necessary.

### Proxy and abuse protection

Rate limits are process-local and reset when the service restarts. The app
sets `trust proxy` to false. Configure trusted edge/proxy abuse protection;
do not blindly trust client-supplied forwarding headers.

Some current limits are shared across a peer or all administrators. Review
them against the chosen host and expected shared-network usage.

### Transport, storage and operator access

Require HTTPS. Use encrypted persistent storage and encrypted, separately
stored backups. Mode-600 files protect against some local users, not the
service account, host administrators or infrastructure compromise.

Review frontend injection risks and third-party font loading. A restrictive
Content Security Policy has not been implemented. No user-supplied HTML should
be executed.

### Account lifecycle

The application does not yet provide:

- MFA or automated email ownership verification.
- Automatic invitation, recovery or partnership notification emails.
- Account suspension/removal or administrator promotion.
- Public email-based recovery for the sole administrator.
- A fully specified retention/deletion policy or automatic backup system.

Verify recipients through a trusted channel when delivering invitations or
recovery codes. Decide who will operate the site and how the sole
administrator's identity will be verified if recovery is needed.

If the only administrator loses their password and all sessions, recovery
requires a deliberate trusted-operator procedure. No automatic operator-reset
script is included. Never erase the database, reopen bootstrap or introduce a
fixed fallback password to regain access.

## Private file handling

Do not share `.env`, private setup files, real database exports, runtime logs
containing sensitive information, invitation/recovery codes, session tokens or
backups. The source ZIP deliberately excludes these files.

The source contains synthetic test credentials, such as `example.test`
addresses. They are created only in isolated test databases and are not
pre-existing login credentials for a deployed website.

## Updates

Review dependency security advisories and apply/test updates regularly. Lockfile
installation provides reproducible versions, not a guarantee that all
dependencies are free of vulnerabilities. This handoff is not a penetration
test or complete third-party dependency audit.
