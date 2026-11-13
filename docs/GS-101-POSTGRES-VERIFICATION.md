# GS-101 PostgreSQL verification — 7 November 2026

**Result: functional checks pass with a 40-connection pool; a reproducible connection-pool limitation remains at 10 connections. Keep issue #101 open pending resolution or explicit acceptance of that limit.**

## Revision and isolation

- Branch: `main`.
- Revision: `5f454f35c215de047584e02e30b5ab44a1c558db` (the revision named in [#101](https://github.com/chankiahuja/Grocery-Suggestor/issues/101)).
- PostgreSQL: **17.11**, local Windows service; Java **17.0.12**.
- Database: local `pantrypal`; each run used a new UUID-suffixed schema through JDBC `currentSchema` and explicit Flyway schema configuration.
- Live verification used a packaged executable JAR, a dynamically allocated HTTP port, and a local SMTP test receiver. Email codes were requested and verified through the real HTTP endpoints; no session credentials were inserted into the database.
- Only verification schemas were created or dropped. Existing application schemas and pantry data were not modified. Owned JVMs and the test SMTP receiver were stopped after each run.
- No runtime source or application configuration was changed.

## Backend suites

Ran these existing suites with the Spring datasource explicitly set to PostgreSQL and `PANTRYPAL_POSTGRES_SMOKE=true`:

```powershell
# From backend, with datasource/Flyway settings directed to a temporary schema:
.\mvnw.cmd '-Dtest=AccountIsolationTest,AdjustmentWorkflowTest,AuthFlowTest,FrontendRoutingTest,InventoryUndoTest,NotificationEventsTest,PantryFlowTest,PostgresAccountOwnershipSmokeTest,ShoppingListResponseContractTest' test
```

**85 tests passed; zero failures, errors, or skips.** This includes the PostgreSQL ownership migration smoke test. Notification unit tests still use mocked repositories; real PostgreSQL/SSE behavior was checked separately below.

The dedicated H2 `FileDatabaseTest` and H2 ownership-migration fixture were excluded from this PostgreSQL claim. Actual process-restart persistence and PostgreSQL migration behavior were verified separately.

## Live API results

The complete successful run used **40 maximum Hikari connections** and a **30,000 ms acquisition timeout**. Two accounts and three simultaneous authenticated sessions exercised real HTTP and SSE connections.

| Check | Observed result |
| --- | --- |
| Flyway | All six migrations applied successfully; version 6 remained current after restart. |
| Account isolation | Simultaneous inventory reads returned only their owner's items. Foreign-account inventory GET, PATCH, and DELETE returned 404. |
| 30 interleaved stock writes | Barrier-released clients alternated consume/restock against the same owned item through two sessions; final stock was unchanged. |
| 30 identical adjustment retries | Same item, payload, and idempotency key applied one restock of 3 exactly once. |
| 30 competing consumes | Starting quantity 10: exactly 10 successful consumes, 20 HTTP 400 rejections, final quantity zero. |
| Shopping ownership | Foreign-account list reads, purchases, and item updates returned 404. Updating an item through another list of the same account also returned 404. |
| 30 purchase retries | Thirty concurrent completions applied the linked restock of 2 exactly once. |
| SSE ownership | Alice inventory changes reached both Alice sessions and produced no inventory signal in Bob's stream. |
| Scheduled notifications | Heartbeat observed. A new Alice low-stock item produced `alerts_changed` only for Alice sessions; Alice suggestions included that item, while Bob suggestions remained empty. |
| 30 writes with live SSE | Thirty clients interleaved consume/restock across Alice and Bob with three streams open. Every request succeeded and each item's final quantity matched the expected net change. |
| Logout | Logged-out stream ended; its cookie received 401 for inventory and an SSE reconnect. The other Alice session and Bob remained active. |
| Account switch / rotation | Signing the second Alice browser into Bob closed its old Alice stream. The rotated session saw Bob's inventory only. |
| Session expiry | Expiry timestamps were set into the past for Alice sessions in the isolated schema. Without further client activity, the scheduled sweep closed the expired stream within the 12-second test deadline. Its cookie received 401; Bob's stream stayed active. |
| SSE payload contract | Observed data frames were `ready` status or a single documented `type`; no inventory contents or account IDs were present. |
| Process restart | The owned JVM was terminated and a new JVM started against the same schema. Both surviving Bob sessions restored successfully, Bob stock persisted, and Flyway still had exactly six successful migrations. |

Test-only settings: expiry sweep every 1,000 ms; resend cooldown 1 second; insecure session cookies for loopback HTTP; fixed disposable OTP signing secret. Expiration was induced through isolated database timestamps, not by waiting for the normal session lifetime. The restart was an actual JVM replacement, not merely reopening a JDBC connection.

### Timings from the final 40-connection run

| Batch (30 simultaneously released clients) | Total | Slowest request |
| --- | ---: | ---: |
| Interleaved stock writes | 0.38 s | 0.36 s |
| Identical adjustment retries | 0.14 s | 0.13 s |
| Competing consumes | 0.14 s | 0.13 s |
| Purchase retries | 0.22 s | 0.20 s |
| Interleaved writes with SSE | 0.83 s | 0.82 s |

These are local smoke-test observations, not throughput benchmarks or production sizing guarantees.

## Failure at pool size 10

Repeated the live checks with **10 maximum connections**. The ordinary 30-client stock, idempotency, no-overdraw, and purchase batches passed. The subsequent batch of 30 interleaved writes with three active SSE streams produced **HTTP 500** responses and connection acquisition failures.

This occurred with both a shortened 5-second acquisition timeout and a 30-second acquisition timeout. In the 30-second run, the batches without SSE completed in approximately 0.15–0.50 seconds; the SSE-enabled write batch failed with messages including:

```text
CannotCreateTransactionException: Could not open JDBC Connection for transaction
SQLTransientConnectionException: HikariPool-1 - Connection is not available,
request timed out after 30007ms (total=10, active=10, idle=0, waiting=2)
POST /api/inventory/2/adjust -> HTTP 500
```

This establishes a pool-capacity/availability problem under the tested concurrency. Synchronous notification dispatch and session validation are candidates for investigation because they add database work to the write-completion path. The precise resource dependency has not been proven by a thread dump; no root-cause fix was implemented or validated here.

The 40-connection pass is a diagnostic comparison, not proof that increasing the pool permanently fixes the design or that 40 connections is sufficient for arbitrary workloads. The failed batch was stopped before asserting its final committed quantities, so this report makes no data-corruption or rollback claim for those HTTP 500 responses. Earlier writes may already have committed.

## Cleanup and remaining work

Every live run and the backend suite removed its own verification schema. A final schema query found no remaining `pp_gs101_*` schemas. The migration smoke test also removed its own scenario schemas.

Before declaring an unconditional pass for #101, investigate the pool-size-10/SSE failure, decide the supported concurrency/pool behavior, and repeat that scenario after any fix. Registration-versus-revocation races and indefinitely stalled transports from #82 remain separate deterministic-concurrency work; this live run does not claim to prove those races.
