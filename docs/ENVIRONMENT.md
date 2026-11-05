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
| MAIL_HOST / MAIL_PORT | localhost / 1025 | Spring SMTP transport; local Mailpit defaults |
| MAIL_FROM | PantryPal <no-reply@pantrypal.test> | Disposable local sender; configure a verified sender for real delivery |
| MAIL_USERNAME / MAIL_PASSWORD | empty | SMTP credentials when using a provider |
| MAIL_SMTP_AUTH / MAIL_STARTTLS | false / false | Enable for a provider that requires them |
| AUTH_COOKIE_SECURE | false in local profile; true otherwise | Secure session-cookie flag; set true behind HTTPS |
| AUTH_OTP_SECRET | random process-local if empty | Set a secret of at least 32 bytes to keep pending codes valid across restarts |
| AUTH_OTP_LIFETIME_SECONDS / AUTH_RESEND_COOLDOWN_SECONDS / AUTH_MAX_ATTEMPTS | 300 / 30 / 5 | Server-side code lifetime, resend delay, per-code attempt cap |
| DEMO_SEED_EMAIL | prompt | Optional email used by the authenticated `seed:demo` command |

For native Windows development, run your installed Mailpit executable with `--listen 127.0.0.1:8025 --smtp 127.0.0.1:1025`, then open http://localhost:8025 to read verification codes. Full-stack sign-in requires this SMTP service when the default `MAIL_HOST`/`MAIL_PORT` are used. Docker Compose runs its own Mailpit service at the same host ports and uses `mailpit:1025` inside its network; stop native Mailpit before starting Compose to avoid port conflicts. The browser-only `dev:mock` mode still uses code `123456` without sending mail or creating a server session.

Normal mode issues an HttpOnly, SameSite=Lax session cookie and a CSRF token returned by `GET /api/auth/session`. Session attributes are stored through Spring Session JDBC; Flyway creates the tables. Cookies are Secure by default outside the `local` profile. Serve a deployed app over HTTPS, keep `AUTH_COOKIE_SECURE=true`, and configure SMTP credentials only through environment variables. Pantry and shopping data is scoped to the signed-in account. A missing `AUTH_OTP_SECRET` invalidates outstanding codes on backend restart, while signed-in sessions continue to work.

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

For PostgreSQL, set `$env:SPRING_PROFILES_ACTIVE = 'postgres'` and configure `DB_URL`, `DB_USER`, and `DB_PASSWORD` before starting. Existing `DB_*` variables do not override the local H2 profile. Compose explicitly selects PostgreSQL. Tests continue to use an isolated in-memory H2 database. H2 compatibility mode does not establish PostgreSQL compatibility.

## Troubleshooting

- Port 5432 occupied: stop the other database or change the Compose host mapping and native DB_URL together.
- Flyway complains about non-empty schema: use a fresh `pantrypal` database; do not baseline the former schema blindly.
- Maven wrapper fails to download: check network access to Maven Central and JAVA_HOME/JDK configuration.
- Windows wrapper requires JAVA_HOME, even if java is already on PATH. For this machine: `$env:JAVA_HOME = 'C:/Program Files/Java/jdk-17'` (use your actual JDK location on another machine).
- Windows Vite native binary missing: reinstall with the current lockfile; this repository now permits Windows native optional dependencies.
- No alerts: add a pantry item with quantity zero or an expiry within seven days. The SSE stream is `/api/notifications/stream`; suggestions are the recoverable alert snapshot.
- Browser notifications require explicit permission. In-app bell alerts work without it.

Prototype limits: account ownership is per account; household sharing and invitations remain separate work. Spring events and SSE are process-local and not durable. Reconnects and polling recover current stock alerts; purchase events are cache refresh signals, not a historical notification inbox.
