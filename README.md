# PantryPal prototype

Household inventory, rule-based grocery suggestions, shopping lists, and event-driven in-app notifications.

The React theme adapts the supplied Pantry Pal design. Its logo, hero image and favicon live in the React app's public assets.

The active backend is Java/Spring Boot in [backend](backend). The React/TypeScript app remains in [artifacts/grocery-app](artifacts/grocery-app). See [environment setup](docs/ENVIRONMENT.md) and [architecture](docs/ARCHITECTURE.md).

## Quick start

### Local application on port 8080 (embedded database)

Install Node.js 24 and Java 17+, and set `JAVA_HOME` to your JDK directory. From the repository root:

```sh
npx pnpm@10.26.1 install
npx pnpm@10.26.1 start
```

Open http://localhost:8080. Spring Boot serves React and the real API using embedded, file-backed H2. No Docker or separate database is required. Flyway creates the schema on first startup. Pantry and shopping data survive restarts in `backend/data/pantrypal.mv.db` (ignored by Git). This starts with an empty pantry; it does not import browser demo data. Stop with Ctrl+C. Restart the command after frontend changes.

The `local` Spring profile is the default. Set `PANTRYPAL_DATA_DIR` to an absolute directory to choose a stable database location when launching from different working directories; otherwise `./data` is relative to the Java process. Set `SPRING_PROFILES_ACTIVE=postgres` and the `DB_URL`, `DB_USER`, `DB_PASSWORD` variables to use PostgreSQL instead.

### Frontend demo (no backend or database)

To add the same sample pantry and Weekend groceries list to the running Spring Boot app on port 8080, run `npx pnpm@10.26.1 seed:demo` from the repository root. This explicit local command reuses the browser demo dataset, adds missing examples through the API, and preserves existing quantities and purchase progress when repeated. It does not import browser localStorage. H2 retains these records across restarts; samples are not automatically recreated when you delete them. Expiry dates for newly added examples are relative to the day you run the command.

```sh
npx pnpm@10.26.1 install
npx pnpm@10.26.1 dev:mock
```

Open http://localhost:5173. Demo mode includes sample pantry items, stock and expiry alerts, and a shopping list. Add/edit/delete items, generate lists, and complete purchases. Changes stay in this browser; **Reset demo data** restores the samples. Sample expiry dates are relative to the day the demo is first seeded. This is local sample data, not an import of the former Replit database.

### Sign-in/sign-up design preview

Every fresh load opens `/login`; use **Create account** to switch to signup. Signup requires a name, held only in the form and cleared on success or when leaving the page. The name is not stored, sent to an API, or shown on Dashboard or other app screens. The sage/ivory theme is maintained within the React app. Both forms support **Mobile number** or **Email address**: enter a 10-digit example number or a valid-format email, then use demo code **123456**. Successful verification opens the dashboard directly, without a confirmation screen. Codes expire after five minutes; resend has a 30-second cooldown. Email addresses, phone numbers and codes stay in component memory and are cleared on success or when leaving the page. No SMS or email is sent, account created, or authenticated session established. Every fresh page load opens `/login`, including direct links to dashboard, inventory, signup, or unknown page URLs. Completing the OTP preview unlocks navigation to `/dashboard` in memory until the page reloads. This is a frontend navigation gate, not API authentication. All page styles and assets are maintained in the React app.

### Optional PostgreSQL setup with Docker

Install Docker Desktop with Compose and start Docker. From the repository root:

```sh
docker compose up --build -d
```

Open http://localhost:8080. Spring Boot's embedded server serves both the built React app and `/api`, including http://localhost:8080/api/healthz. No Vite server is required. PostgreSQL data persists in the Compose volume. `docker compose down` stops the services and retains data. Rebuild with the same command after source changes.

For native Java development with PostgreSQL, set `SPRING_PROFILES_ACTIVE=postgres`, configure `DB_URL`, `DB_USER`, and `DB_PASSWORD`, and start your database. From the repository root run:

```sh
npx pnpm@10.26.1 install
npx pnpm@10.26.1 start
```

This builds React, copies its output into the Spring classpath through Maven resources, and starts Spring Boot on http://localhost:8080. Restart this command after frontend changes. To package a standalone JAR, run `npx pnpm@10.26.1 build`, then `sh ./mvnw clean package` inside `backend` (Windows: `.\mvnw.cmd clean package`). The wrapper downloads Maven on first use. Optional Vite hot reload remains available with `npx pnpm@10.26.1 dev` on port 5173 while Spring is running.

## Checks

```sh
# From backend; Windows uses mvnw.cmd
sh ./mvnw test
# From repository root
npx pnpm@10.26.1 --filter @workspace/grocery-app typecheck
npx pnpm@10.26.1 --filter @workspace/grocery-app test
npx pnpm@10.26.1 build
```

Backend tests use H2 in PostgreSQL compatibility mode, with the actual Flyway migration. PostgreSQL runtime checks still require Docker or an accessible PostgreSQL server.

## Migration boundary

The original Express backend, Drizzle database library and server-side Zod package are retained as historical reference, excluded from the active pnpm workspace. Do not start them alongside Spring. The existing generated React client continues using the same `/api` contract.

Use a fresh prototype database. Existing Drizzle databases are **not automatically imported** or baselined by Flyway. Export/import work is separate from this code migration.

Agent entry points: [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), [GEMINI.md](GEMINI.md). Project workflow skill: [pantrypal-development](.agents/skills/pantrypal-development/SKILL.md).
