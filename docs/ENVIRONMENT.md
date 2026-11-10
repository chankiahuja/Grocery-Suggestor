# Environment and local development

## Tools

For frontend-only exploration, use `npx pnpm@10.26.1 dev:mock` and open http://localhost:5173. Only Node/pnpm is required. This explicit Vite mode intercepts `/api` fetches in the browser and uses localStorage; it disables the backend SSE connection. The normal `dev` command still uses Spring. The demo banner has a reset button.

- Java JDK 17+ (Java 21 in Docker); no global Maven required with the wrapper.
- Node.js 24 and pnpm 10.26.1 (`npx pnpm@10.26.1 ...` works without a global install).
- Embedded file-backed H2 is the default local database; no external database is needed.
- Docker with Compose is optional for the PostgreSQL configuration.

## Variables

Copy [`.env.example`](../.env.example) to `.env` to override Compose credentials. Defaults run without copying it. Native Java does not automatically load `.env`: set variables in your shell or IDE.

| Variable | Default | Used by |
|---|---|---|
| SPRING_PROFILES_ACTIVE | local (default profile) | Spring; use postgres for PostgreSQL |
| PANTRYPAL_DATA_DIR | ./data | Local H2 files, relative to Java working directory |
| DB_URL | jdbc:postgresql://localhost:5432/pantrypal | PostgreSQL profile |
| DB_USER | pantrypal | PostgreSQL / Compose |
| DB_PASSWORD | pantrypal | PostgreSQL / Compose |
| API_PORT | 8080 | Native Spring |
| EXPIRY_CHECK_MS | 60000 | Native Spring scheduler |
| PORT | 5173 | Vite |
| BASE_PATH | / | Vite |
| API_TARGET | http://localhost:8080 | Vite proxy |
| VITE_ENABLE_MOBILE_PREVIEW | false | Vite build-time opt-in for the preserved, unauthenticated mobile preview; not SMS authentication |
| MAIL_HOST / MAIL_PORT | localhost / 1025 | Spring SMTP transport for native Java; local Mailpit defaults |
| MAIL_FROM | PantryPal <no-reply@pantrypal.test> | Disposable local sender; configure a verified sender for real delivery |
| MAIL_USERNAME / MAIL_PASSWORD | empty | SMTP credentials when using a provider |
| MAIL_SMTP_AUTH / MAIL_STARTTLS | false / false | Enable for a provider that requires them; external SMTP with auth must also enable TLS |
| PANTRYPAL_SMTP_HOST / PANTRYPAL_SMTP_PORT | mailpit / 1025 | Optional Docker Compose SMTP override; leave unset to use Mailpit |
| PANTRYPAL_SUPPORT_EMAIL | empty | Recipient for Contact & Feedback submissions and displayed support link; the selected mailbox is `support@mypantrypal.in`; configure outside source control |
| PANTRYPAL_SUPPORT_RESPONSE_TIME | empty | Optional, verified response expectation shown on the contact page; never inferred or invented |
| AUTH_COOKIE_SECURE | false in local profile; true otherwise | Secure session-cookie flag; set true behind HTTPS |
| AUTH_OTP_SECRET | random process-local if empty | Set a secret of at least 32 bytes to keep pending codes valid across restarts |
| AUTH_OTP_LIFETIME_SECONDS / AUTH_RESEND_COOLDOWN_SECONDS / AUTH_MAX_ATTEMPTS | 300 / 30 / 5 | Server-side code lifetime, resend delay, per-code attempt cap |
| DEMO_SEED_EMAIL | prompt | Optional email used by the authenticated `seed:demo` command |

For native Windows development, run your installed Mailpit executable with `--listen 127.0.0.1:8025 --smtp 127.0.0.1:1025`, then open http://localhost:8025 to read verification codes. Full-stack sign-in requires this SMTP service when the default `MAIL_HOST`/`MAIL_PORT` are used. Docker Compose runs its own Mailpit service at the same host ports and uses `mailpit:1025` inside its network; stop native Mailpit before starting Compose to avoid port conflicts. The browser-only `dev:mock` mode still uses code `123456` without sending mail or creating a server session.

Normal mode issues an HttpOnly, SameSite=Lax session cookie and a CSRF token returned by `GET /api/auth/session`. Session attributes are stored through Spring Session JDBC; Flyway creates the tables. Cookies are Secure by default outside the `local` profile. Serve a deployed app over HTTPS, keep `AUTH_COOKIE_SECURE=true`, and configure SMTP credentials only through environment variables. Pantry and shopping data is scoped to the signed-in account. A missing `AUTH_OTP_SECRET` invalidates outstanding codes on backend restart, while signed-in sessions continue to work.

For SMTP, the local Mailpit default stays unencrypted, but any external provider that requires authentication must also enable TLS. We explicitly reject that configuration at startup unless `MAIL_STARTTLS=true`. In the shared root `.env`, single-quote secrets containing `$` or `#` so Compose preserves the full value, for example `MAIL_PASSWORD='pa$word'` or `MAIL_PASSWORD='abc#123'`. Unquoted values are easy to rewrite during Compose interpolation. The root `pnpm start` launcher loads the ignored root `.env` for native Java; launching Maven directly still requires setting variables in the shell or IDE. Compose uses Mailpit by default; set `PANTRYPAL_SMTP_HOST` and `PANTRYPAL_SMTP_PORT` to override it, and configure `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_SMTP_AUTH`, `MAIL_STARTTLS`, and a verified `MAIL_FROM` as required by the provider. A message accepted by Mailpit is only captured locally, not delivered to the support inbox. If no support address is configured, the app displays a neutral unconfigured state and does not report successful delivery. Do not promise a response time until one is decided; `PANTRYPAL_SUPPORT_RESPONSE_TIME` remains optional and is displayed only when explicitly configured. User-submitted message contents are sent to the mailbox and are not written to application logs or the database. Configure support details and SMTP credentials through ignored local environment files or deployment environment, never source control.

### Production profile and reverse proxy

Set `SPRING_PROFILES_ACTIVE=production` in the deployed service. The `production` profile includes `postgres`, sets `AUTH_COOKIE_SECURE=true`, and fails startup if secure cookies are disabled or `AUTH_OTP_SECRET` is absent/shorter than 32 bytes. It honors forwarded headers so TLS termination at the proxy is recognized; Spring Security emits HSTS for secure requests. Deploy only behind a trusted TLS-terminating reverse proxy or ingress that redirects public HTTP to HTTPS, removes untrusted client-supplied `Forwarded`/`X-Forwarded-*` headers, and writes its own; do not expose the app directly with forwarded-header processing enabled. Keep database, SMTP, and OTP secrets in the deployment platform's secret manager, not repository files or build args. The root Docker Compose configuration is for local development and deliberately disables Secure cookies for localhost HTTP; do not use it as a production deployment without overriding and verifying the security settings.

### Render staging

The root [`render.yaml`](../render.yaml) Blueprint defines `pantrypal-staging` as a free Docker web service and `pantrypal-staging-db` as a free PostgreSQL 17 database in Oregon. This is a short-lived test setup, not production: free web services can spin down and have ephemeral filesystems, and free Postgres has a fixed 1 GB limit, expires 30 days after creation, and does not include backups. Do not store important data in this test database. The web service uses Render's default `onrender.com` URL, internal database networking, `/api/healthz` for health checks, and the `production` Spring profile. The production profile listens on Render's injected `PORT`. `AUTH_OTP_SECRET` is generated by Render. `PANTRYPAL_SMTP_REQUIRED=false` is set only to let this deployment check run without Brevo credentials; email OTP and contact-email delivery are not available until SMTP is configured. The Blueprint deliberately has no Brevo credential or sender prompts.

To provision this test setup, push the branch containing `render.yaml`, sign in to Render, create a new Blueprint from this repository and branch, confirm both plans are `Free`, and apply the Blueprint. Do not copy deployment secrets into GitHub, `.env`, build args, or issue comments. Render automatically provisions TLS for its default URL; verify HTTP-to-HTTPS redirection at the public URL and confirm the proxy overwrites forwarded headers. Before using the deployment beyond this short test, upgrade both plans, configure Brevo credentials and a verified sender in Render environment settings, and set `PANTRYPAL_SMTP_REQUIRED=true`. See [Render Blueprint documentation](https://render.com/docs/blueprint-spec) and [Render free instance limitations](https://render.com/docs/free).

### Mobile preview opt-in

Login and signup offer email only by default, including `dev:mock`. The mobile preview remains in the source and can be explicitly enabled for development with a Vite build-time flag:

```powershell
$env:VITE_ENABLE_MOBILE_PREVIEW = 'true'
npx.cmd pnpm@10.26.1 dev:mock
```

Restart Vite after changing the flag; a packaged frontend must be rebuilt to change it. Set it to `false` or remove it and restart/rebuild to restore the launch default. Vite can also read an app-local `.env.local`; the repository-root Compose `.env` does not automatically configure a native frontend build. The preserved country selector defaults to India (+91), keeps its selection across steps, and retains its existing validation.

This restores a preview only: no SMS is sent, no mobile account is created, and normal-mode mobile verification cannot authenticate against Spring. The UI switch and its handler guards are not a security boundary; server-side email OTP and sessions remain authoritative. Do not use the preview flag as a recovery path for real mobile-only accounts. See the [release account check](GS-114-EMAIL-ONLY-AUTH.md).

### Claiming legacy shared pantry data

V6 assigns existing unowned inventory and shopping rows to the lowest-ID account present when it runs. If there are no accounts, legacy rows stay unowned and are hidden from all account-scoped APIs. Signup and login never claim them automatically. V6-assigned rows are not automatically reclassified later; review the target database's ownership before enabling access for multiple accounts. An operator must verify which account is entitled to any remaining unowned legacy data before assigning it; if ownership cannot be verified, leave the rows unowned.

After confirming the intended account, inspect its ID (`SELECT id, email FROM accounts ORDER BY id;`) and run the following in a database transaction, replacing `123` with that verified ID:

```sql
BEGIN;
UPDATE inventory_items SET account_id = 123 WHERE account_id IS NULL;
UPDATE shopping_lists SET account_id = 123 WHERE account_id IS NULL;
UPDATE shopping_list_items SET account_id = 123 WHERE account_id IS NULL;
COMMIT;
```

This claims all remaining unowned legacy rows for one account. Back up the database first and do not run it if unowned rows need different owners.

The default full-stack application uses Spring Boot's embedded server on http://localhost:8080 for React assets and `/api`, including SSE. Maven includes `artifacts/grocery-app/dist/public` as classpath static resources; build React before running Maven directly. Docker Compose builds both frontend and backend from the repository root. Use `docker build -f backend/Dockerfile .` for a standalone image build.

Vite is optional for hot reload on port 5173. It reads shell variables in its configuration and proxies `/api` requests, including SSE, to Spring.

Windows native example (Node.js 24 and JDK 17+ required), from the repository root:

```powershell
$env:JAVA_HOME = 'C:/Program Files/Java/jdk-17'
npx pnpm@10.26.1 install
npx pnpm@10.26.1 start
```

Open http://localhost:8080. Use your installed JDK path for `JAVA_HOME`. The start command rebuilds React before starting Java and uses the default `local` profile, with H2 at `backend/data/pantrypal.mv.db`. Data survives restarts. Do not open the same database from multiple application processes. Set an absolute `PANTRYPAL_DATA_DIR` to keep the location consistent across launch methods. The H2 console is not enabled. No browser-side mock is enabled in this mode.

For native PostgreSQL, set `$env:SPRING_PROFILES_ACTIVE = 'postgres'` and configure `DB_URL`, `DB_USER`, and `DB_PASSWORD` before starting. Existing `DB_*` variables do not override the local H2 profile. Use `jdbc:postgresql://localhost:5432/pantrypal` for normal local app use. Use the separate `jdbc:postgresql://localhost:5432/pantrypal_auth_test` database for destructive, migration, concurrency, or load tests; never point those tests at production or the normal app database. Compose explicitly selects PostgreSQL. Tests continue to use an isolated in-memory H2 database unless a PostgreSQL-specific smoke test is explicitly enabled. H2 compatibility mode does not establish PostgreSQL compatibility.

Switching from H2 to PostgreSQL does not transfer or delete H2 records. Keep the H2 database files intact; if existing records are needed in PostgreSQL, plan and verify a separate one-time export/import before switching normal app use. PantryPal's notifications are process-local refresh signals, not durable records; after restart, active alerts are reconstructed from the PostgreSQL-backed pantry via `/api/suggestions`.

The opt-in PostgreSQL smoke tests create and drop uniquely named schemas inside the isolated test database. From `backend`, configure only `DB_URL`, `DB_USER`, and `DB_PASSWORD` for `pantrypal_auth_test`, then run:

```powershell
$env:DB_URL = 'jdbc:postgresql://localhost:5432/pantrypal_auth_test'
$env:DB_USER = '<local test database user>'
$env:DB_PASSWORD = '<local test database password>'
$env:PANTRYPAL_POSTGRES_SMOKE = 'true'
.\mvnw.cmd '-Dtest=PostgresAccountOwnershipSmokeTest' test
$env:PANTRYPAL_POSTGRES_RUNTIME_SMOKE = 'true'
.\mvnw.cmd '-Dtest=PostgresRuntimeSmokeTest' test
```

The runtime smoke starts the real `postgres` profile twice, applies and validates Flyway migrations, checks account/inventory/list and recoverable alert persistence, verifies service-layer two-account isolation, and runs 30 concurrent stock updates through a pool capped at two connections. It does not exercise HTTP/session isolation or prove notification delivery across restart. Notifications are not durable; only the active alert snapshot is reconstructed from inventory. Never set these test variables to the normal app database.

## Troubleshooting

- Port 5432 occupied: stop the other database or change the Compose host mapping and native DB_URL together.
- Flyway complains about non-empty schema: use a fresh `pantrypal` database; do not baseline the former schema blindly.
- Maven wrapper fails to download: check network access to Maven Central and JAVA_HOME/JDK configuration.
- Windows wrapper requires JAVA_HOME, even if java is already on PATH. For this machine: `$env:JAVA_HOME = 'C:/Program Files/Java/jdk-17'` (use your actual JDK location on another machine).
- Windows Vite native binary missing: reinstall with the current lockfile; this repository now permits Windows native optional dependencies.
- No alerts: add a pantry item with quantity zero, an expiry within seven days, or positive quantity and a past expiry date. Expired and upcoming expiry use UTC dates. The SSE stream is `/api/notifications/stream`; suggestions are the recoverable alert snapshot.
- Browser notifications require explicit permission. In-app bell alerts work without it.

Prototype limits: account ownership is per account; household sharing and invitations remain separate work. Spring events and SSE are process-local and not durable. Reconnects and polling recover current stock alerts; purchase events are cache refresh signals, not a historical notification inbox.
