# PantryPal agent instructions

Read [README.md](README.md), [environment](docs/ENVIRONMENT.md), and [architecture](docs/ARCHITECTURE.md) before changing runtime behavior.

- Prototype: Java/Spring Boot backend, PostgreSQL, React/TypeScript. Preserve existing pantry and shopping behavior.
- Active backend: `backend/`. Do not implement new features in the historical Express/Drizzle packages.
- Preserve `/api` response shapes consumed by `lib/api-client-react`. Update OpenAPI and regenerate the client when the REST contract changes.
- Database changes are new Flyway migrations; do not edit an applied migration or run Drizzle push against the Spring database.
- Keep purchase completion transactional and repeat-safe; validate list/item ownership.
- Publish notification signals after commit. Do not add a broker or external delivery service without a requirement.
- Never commit real environment secrets. Examples use disposable local credentials.
- Read `.agents/memory/` entries relevant to the task. Use the [development skill](.agents/skills/pantrypal-development/SKILL.md) for migration, API or environment changes.
- Run focused backend and frontend checks for affected behavior. Report exact checks and any environmental blockers; do not claim H2 proves PostgreSQL compatibility.
- Keep a single shared source of guidance here; provider-specific files should point here.
