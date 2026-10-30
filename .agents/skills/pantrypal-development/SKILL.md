---
name: pantrypal-development
description: Modify PantryPal prototype APIs, event notifications, database migrations, React integration, or local environment setup.
---

Read [shared instructions](../../../AGENTS.md) and the [architecture](../../../docs/ARCHITECTURE.md). Read [environment setup](../../../docs/ENVIRONMENT.md) when running or changing tools.

Trace changes through Spring controller/service/repository, OpenAPI, generated React hooks and affected screens. Keep the existing response contract unless the task explicitly changes it. Add a Flyway migration for schema changes.

Check shortage generation, expiry-only exclusion, list-scoped item changes, repeated purchase completion and rollback for changes to stock or shopping logic. Use `backend/mvnw test` from the backend directory as `./mvnw test` (Windows `./mvnw.cmd test`). H2 tests do not replace a PostgreSQL smoke check when a database is available.

For UI changes run the grocery-app typecheck and focused tests. Existing JSDOM test setup requires browser globals before dynamic imports; see [test memory](../../memory/jsdom-ui-tests.md). Review workspace YAML after installs; retain release-age policy and unrelated overrides.

SSE only signals invalidation; recover alerts from `/api/suggestions`. Do not treat process-local events as durable notifications. Report blockers and verification limits explicitly.
