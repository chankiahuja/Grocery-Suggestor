# PantryPal prototype

Household inventory, rule-based grocery suggestions, shopping lists, and event-driven in-app notifications.

The React theme adapts the supplied Pantry Pal design. Its logo, hero image and favicon are copied into the app's public assets; the app does not load anything from the original reference folder, which can be deleted independently.

The active backend is Java/Spring Boot in [backend](backend). The React/TypeScript app remains in [artifacts/grocery-app](artifacts/grocery-app). See [environment setup](docs/ENVIRONMENT.md) and [architecture](docs/ARCHITECTURE.md).

## Quick start

### Frontend demo (no backend or database)

```sh
npx pnpm@10.26.1 install
npx pnpm@10.26.1 dev:mock
```

Open http://localhost:5173. Demo mode includes sample pantry items, stock and expiry alerts, and a shopping list. Add/edit/delete items, generate lists, and complete purchases. Changes stay in this browser; **Reset demo data** restores the samples. Sample expiry dates are relative to the day the demo is first seeded. This is local sample data, not an import of the former Replit database.

### Full stack

Install Docker Compose, Node.js 24 and pnpm 10.26.1. From the repository root:

```sh
docker compose up --build -d
npx pnpm@10.26.1 install
npx pnpm@10.26.1 dev
```

Open http://localhost:5173. The API is at http://localhost:8080/api/healthz. PostgreSQL data persists in the Compose volume. `docker compose down` stops the services and retains data.

For Java development, start only the database (`docker compose up -d db`), then run `sh ./mvnw spring-boot:run` inside `backend` (Windows: `.\mvnw.cmd spring-boot:run`). Java 17+ is supported; the Docker image uses Java 21. The wrapper downloads Maven on first use.

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
