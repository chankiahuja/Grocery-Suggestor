# GS-102: concurrent adjustments with active notification streams

Verified locally on 2026-11-07 for [issue #102](https://github.com/chankiahuja/Grocery-Suggestor/issues/102). The failure reproduces on PostgreSQL and H2. Moving committed refresh signals to a bounded delivery worker removes the reproduced pool starvation without increasing the connection pool.

## Reproduction and diagnosis

The baseline executable contained the runtime at `5f454f35c215de047584e02e30b5ab44a1c558db`; branch `GS-101` subsequently added the GS-101 verification document in `e4f53ee`. The fixed runs used the working-tree backend changes on that branch.

The local HTTP harness used real email-code signup/login through a loopback SMTP receiver, two accounts, three authenticated sessions and three open SSE streams. Thirty clients started together and sent interleaved consume/restock requests against the two accounts' items, each with a distinct idempotency key. Both databases used a Hikari pool of **10** and a **5,000 ms acquisition timeout**. The shorter timeout makes starvation visible without waiting for the default timeout; the pool was not enlarged for the fix. The expiry sweep ran every second.

| Baseline database | Initial responses out of 30 | History rows before retry | Reconciliation after retrying all original keys |
| --- | --- | --- | --- |
| PostgreSQL 17.11 | 9 HTTP 200; 21 HTTP 500 | 9 | 30 rows, 30 distinct keys, exact expected stock |
| H2 2.3.232, file database in PostgreSQL mode | 15 HTTP 200; 13 HTTP 500; 2 incomplete HTTP responses | 21 | 30 rows, 30 distinct keys, exact expected stock |

The H2 result also demonstrates why an incomplete or failed response must be retried with the original key: the response count alone does not establish which transactions committed. Its baseline run passed stock reconciliation and auth/stream checks but ended on a harness assertion that counted Flyway's schema-creation marker as a migration. The assertion was corrected to count versioned migrations before the fixed runs; that baseline is not reported as a completely passing run.

A thread dump during the PostgreSQL failure placed request threads in `NotificationEvents.changed`, subscriber delivery locks, and Spring Session's `JdbcIndexedSessionRepository.findById`, waiting for another connection. PostgreSQL activity showed the ten application connections idle at the server, mostly with the last statement `COMMIT`, rather than waiting on database row locks.

`@TransactionalEventListener` defaults to after commit, but its callback runs before Spring cleans up the transaction's connection. Synchronous delivery therefore retained each writer's connection while waiting for another connection for session validation, or for a subscriber's send lock. Concurrent writers could occupy the entire pool and prevent those validations from progressing. Catching session lookup exceptions or enlarging the pool does not remove this connection dependency.

## Change

[NotificationEvents](../backend/src/main/java/com/pantrypal/NotificationEvents.java) now only enqueues the account-scoped refresh signal from the after-commit callback. [NotificationDeliveryConfig](../backend/src/main/java/com/pantrypal/NotificationDeliveryConfig.java) owns a single delivery thread and a queue of 128 tasks. Neither a session lookup nor an emitter write runs on the transaction publisher thread. Overflow/shutdown logs and discards the best-effort signal; it never falls back to delivery on that thread.

Existing per-subscriber validation and closure checks still run immediately before delivery. Queued events cannot revive a logged-out stream. Event types, account routing, REST responses, database schema and stock/idempotency transactions are unchanged.

These remain process-local refresh signals, not durable messages. A stalled subscriber can delay this worker and a full queue can discard signals. HTTP mutation responses refresh the initiating UI, and the existing notification snapshot polling recovers current alerts. This fix does not claim unlimited throughput or solve all slow-client delivery behavior.

## Verification of the fix

The same live harness ran **three consecutive bursts of 30** on each database, retaining pool size 10 and the 5-second acquisition timeout:

| Database | Original adjustment responses | Each burst's committed keys before retry | Burst elapsed times |
| --- | --- | --- | --- |
| PostgreSQL 17.11 | 90/90 HTTP 200 | 30/30, exactly once | 1.50 s, 1.62 s, 1.56 s |
| H2 2.3.232, file database | 90/90 HTTP 200 | 30/30, exactly once | 2.31 s, 2.49 s, 2.40 s |

After every burst the harness replayed all 30 original keys and checked the database history count, distinct key count and both items' exact stock. All passed, with no additional history rows or stock changes on replay. These timings describe these local runs, not a latency guarantee.

Both fixed database runs also passed:

- Thirty concurrent writes before opening SSE; thirty retries of one adjustment; thirty competing consumes with exactly ten successes, twenty expected HTTP 400 responses and zero stock; thirty purchase-completion retries with exactly one restock.
- Foreign-account reads/writes and mismatched shopping-list operations rejected; inventory events reached both owner sessions without reaching the other account; scheduled alerts and heartbeats preserved their existing routing and payloads.
- Logout closed the affected stream and rejected its old cookie; account switching rotated the session and closed the previous account's stream; database expiry closed only the expired sessions.
- A new JVM restored authenticated sessions and stock, with all six versioned migrations already applied. Each run stopped its owned JVM and removed its isolated PostgreSQL schema or H2 directory. The default PostgreSQL schema was untouched.

Automated checks:

- `backend/mvnw.cmd test`: **91 tests run, 90 passed, 1 skipped**, zero failures/errors. The skipped test requires the opt-in PostgreSQL environment.
- PostgreSQL suite, using a temporary schema and `PANTRYPAL_POSTGRES_SMOKE=true`: **88 passed**, zero failures/errors/skips. Command: `backend/mvnw.cmd -Dtest=AccountIsolationTest,AdjustmentWorkflowTest,AuthFlowTest,FrontendRoutingTest,InventoryUndoTest,NotificationEventsTest,PantryFlowTest,PostgresAccountOwnershipSmokeTest,ShoppingListResponseContractTest test`. Datasource/driver/Flyway settings selected PostgreSQL explicitly. H2-specific migration/file fixtures were excluded from this run; they passed in the default suite.
- The 20 notification unit-test executions include new coverage for enqueueing without a session lookup, validation at queued delivery time, logout before queued delivery, and rejection of a full real executor queue without publisher-thread fallback. Auth integration assertions await asynchronous delivery and use a thread-safe recording emitter.
- `backend/mvnw.cmd -DskipTests package`: successful executable build used by the live tests.

Local diagnostic files are ignored scratch output under `tmp/`: `gs102-before-reconciled.log`, `gs102-before-threads.txt`, `gs102-before-activity.json`, `gs102-h2-before.log`, `gs102-postgres-after.log`, `gs102-h2-after.log` and `gs102-postgres-suite.log`. They are not required runtime assets. No frontend code or REST contract changed.
