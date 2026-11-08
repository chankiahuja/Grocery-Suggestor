# GS-113: expired inventory attention

Implementation of [issue #113](https://github.com/chankiahuja/Grocery-Suggestor/issues/113).

## Behavior

- Positive-quantity inventory with an expiry date before today in UTC produces an `expired` suggestion and contributes to `expiredCount` in inventory stats. Today through seven days ahead remains upcoming expiry.
- Expired alerts are independent of low-stock alerts. An expired, low-stock item has both entries; category attention totals count the item once. Zero-quantity items retain their out-of-stock alert without an expired alert.
- Shopping generation explicitly accepts only `critical` and `low`. Expired-only and upcoming-expiry-only reminders cannot create purchases. A low-stock item that is also expired is included once.
- Dashboard counters and category summaries include Expired. Suggestions and notifications link to the exact account-scoped inventory item using `?item=<id>`. The Expired counter opens `?stock=expired`.
- Inventory shows an Expired badge and date alongside any low-stock badge. Correcting or clearing the date, deleting the item, or using its quantity down to zero clears expired attention.
- Opening notifications marks them read without dismissing active conditions. Read markers use account-scoped storage and stable inventory IDs. There is no new handled/dismissed state or database migration.
- Server scheduling detects changes in the account's suggestion snapshot. Open frontend pages also check the UTC date every 30 seconds and when visibility changes, refreshing stats and alerts on rollover without requiring an inventory edit.
- Demo mode uses the same expiry rules. OpenAPI and generated React/Zod models include the additional urgency and stats field.

## Verification

From `backend`, with `JAVA_HOME` set to the installed JDK:

```powershell
./mvnw.cmd test
```

Result: **104 tests run, 103 passed, one opt-in PostgreSQL ownership smoke test skipped**, no failures or errors. The suite includes five new expiry regressions in [ExpiryAlertsTest](../backend/src/test/java/com/pantrypal/ExpiryAlertsTest.java).

The focused expiry, pantry/purchase, account-isolation and notification checks also ran against **PostgreSQL 17.11**, with **41 tests passed**, no failures or skips. The run used a newly created `pp_gs113_<random>` schema with all six Flyway migrations, then dropped that schema. The default application schema was not changed. H2 compatibility mode was not used as proof of PostgreSQL behavior.

PostgreSQL invocation used the following selectors and overrides, with `<schema>` replaced by the disposable schema name:

```powershell
./mvnw.cmd '-Dtest=ExpiryAlertsTest,PantryFlowTest,AccountIsolationTest,NotificationEventsTest' `
  '-Dspring.profiles.active=postgres' `
  '-Dspring.datasource.url=jdbc:postgresql://localhost:5432/pantrypal?currentSchema=<schema>' `
  '-Dspring.datasource.driver-class-name=org.postgresql.Driver' `
  '-Dspring.datasource.username=pantrypal' '-Dspring.datasource.password=pantrypal' `
  '-Dspring.flyway.schemas=<schema>' '-Dspring.flyway.default-schema=<schema>' test
```

The credentials above are disposable local examples. Create the isolated schema before running and drop only that schema afterward.

From the repository root:

```powershell
npx.cmd pnpm@10.26.1 --filter @workspace/api-spec codegen
npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app typecheck
npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app exec tsx --test --test-concurrency=1 src/lib/category-attention.test.ts src/mocks/pantry-api.test.ts src/pages/dashboard.inventory.test.tsx
npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app exec tsx --test '--test-name-pattern=refreshes dashboard attention at UTC midnight' src/pages/dashboard.inventory.test.tsx
npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app exec tsx --test --test-concurrency=1 src/pages/auth.session.test.tsx
npx.cmd pnpm@10.26.1 build
```

API generation and typechecking passed. The first focused frontend run passed **52 tests**; the subsequently added UTC-midnight UI regression passed separately. The auth/session suite passed **13 tests**. The production build passed, including workspace typechecks.

The UI regressions exercise dashboard/category counts, expired versus upcoming dates, overlapping stock conditions, exact-item links from notifications, date correction, deletion, zero-stock behavior, shopping exclusion, and a UTC date rollover without an inventory edit. Backend coverage separately verifies owner isolation and date boundaries. Browser demo checking used a past-dated Greek yogurt item to confirm the counter, distinct expired notification, expiry date and review link.

Local logs and browser QA captures are ignored scratch output under `tmp/gs113-*`.
