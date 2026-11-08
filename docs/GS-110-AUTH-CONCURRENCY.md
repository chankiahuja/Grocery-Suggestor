# GS-110: auth bursts without connection-pool starvation

Verified locally on 2026-11-08 for [issue #110](https://github.com/chankiahuja/Grocery-Suggestor/issues/110). The change is based on checkout `437ed43`; the affected auth sources are identical to the issue's reported `7e24733` revision.

## Cause and change

Both auth entry points previously started a JDBC transaction before calling the rate limiter. The limiter uses `REQUIRES_NEW` to preserve quotas on rejected requests. Each caller retained its outer connection while requesting a second connection, allowing concurrent requests to occupy the whole pool and prevent progress. Session persistence then also waited for connections. Code requests additionally retained a connection and challenge-row lock throughout SMTP delivery.

[AuthService](../backend/src/main/java/com/pantrypal/AuthService.java) now claims independently committed rate limits before opening a short challenge transaction. Verification locks, checks, consumes the code and creates/reuses the account in one transaction. Expected rejection results are thrown after commit so failed-attempt counters and consumed unknown-account login codes persist. Unexpected database errors roll back.

Code requests commit an unusable reservation, send email outside the transaction, and activate only the matching challenge after successful delivery. Failure cleanup also matches the challenge ID. An older send cannot invalidate a newer resend or revive a consumed challenge. If the process stops during delivery, the reservation remains unusable and the user can resend after the normal cooldown.

The REST shapes, database schema, quotas, cooldown and SMTP timeouts are unchanged. No migration, client regeneration, broker or pool enlargement is required.

## Reproduction and live results

The baseline used the pre-existing local executable, preserved before packaging the fix (SHA-256 `e34e320cae3454b8d0155c2a8b6f11fba3760ac316ba3ceebcc2030418c745a0`). Its exact build revision was not recorded. On an isolated PostgreSQL schema, 100 anonymous session requests succeeded, followed by **100/100 HTTP 500** code requests in 5.59 seconds. Hikari logged ten active connections, zero idle connections and up to 91 waiting requests. The acquisition timeout was 5,000 ms, shortened for diagnosis.

The fixed executable was built from this working tree. Each run used a fresh database: H2 2.3.232 in file mode or PostgreSQL 17.11 with a unique schema. Both kept pool size **10** and acquisition timeout **5,000 ms**. A local threaded SMTP receiver accepted real messages with backlog 256. No frontend mock intercepted requests.

Each of 100 HTTP clients bound its socket to a distinct source address (`127.0.1.1` through `127.0.1.100`) and maintained separate cookies/CSRF tokens. The database contained exactly 100 request-IP buckets after signup, confirming the application distinguished the source addresses. These are local socket clients, not a geographically distributed capacity benchmark. The configured 30-second resend cooldown was preserved; login started after 31 seconds.

| Concurrent phase | H2 responses; elapsed | PostgreSQL responses; elapsed |
| --- | --- | --- |
| Signup code requests | 100 HTTP 200; 0.965 s | 100 HTTP 200; 0.798 s |
| Signup verification | 100 HTTP 200; 0.345 s | 100 HTTP 200; 0.467 s |
| Login code requests | 100 HTTP 200; 0.393 s | 100 HTTP 200; 0.552 s |
| Login verification | 100 HTTP 200; 0.203 s | 100 HTTP 200; 0.329 s |
| Code requests sharing one fresh source IP | 20 HTTP 200, 80 HTTP 429; 0.171 s | 20 HTTP 200, 80 HTTP 429; 0.235 s |

Both fixed runs also verified:

- Exactly 100 distinct authenticated accounts and session cookies after signup and login.
- Each account created an inventory item; all 100 concurrent inventory reads returned only their owner's item.
- All 100 accounts opened SSE streams. An inventory change reached its owner; the other 99 accounts received no inventory-change signal.
- No connection acquisition timeout appeared in the Hikari/application logs.
- The owned application process stopped after the run. Temporary PostgreSQL schemas were dropped; the default schema was untouched. H2 diagnostic files remain in ignored scratch directories.

These are single local live runs on each database, not sustained-throughput guarantees. The SMTP receiver initially had an insufficient listen backlog and returned delivery failures under the fixed application's faster burst; the reported fixed runs use backlog 256.

## Automated regression coverage

[AuthConcurrencyTest](../backend/src/test/java/com/pantrypal/AuthConcurrencyTest.java) uses a pool of **two**, with a 30,000 ms acquisition timeout:

- Occupies one slot and completes signup, verification and a cooldown rejection using the single remaining connection. This detects nested acquisition without depending on thread scheduling.
- Starts 100 independent signup and login flows through the Spring MVC/security/session stack. All 100 mail calls rendezvous before returning and assert no active transaction, so SMTP cannot retain a database transaction. Cookies, accounts and inventory reads remain isolated.
- Verifies exactly 20 successes/80 HTTP 429 responses for code requests from one IP, and exactly 60 successes/40 HTTP 429 responses for verification from one IP.
- Checks delayed SMTP success and failure against both usable and already-consumed newer challenges; pending delivery cannot authenticate.

The existing [AuthFlowTest](../backend/src/test/java/com/pantrypal/AuthFlowTest.java) also checks failed attempts, expiry, delivery failure, single-use verification, unknown-account login consumption, session rotation and logout.

Commands use the Windows wrapper from `backend` with `JAVA_HOME` set to the installed JDK:

```powershell
./mvnw.cmd test
./mvnw.cmd test package
```

The final H2 backend suite ran **99 tests: 98 passed, one opt-in PostgreSQL ownership smoke test skipped**, with no failures or errors. The auth concurrency class separately passed **all eight tests on PostgreSQL 17.11**, with no skips. Packaging succeeded via `test package` before the final test-only addition; the runtime source used for the live runs is unchanged.

For PostgreSQL, create a disposable schema first, set `AUTH_BURST_DB_URL` to a PostgreSQL URL with `?currentSchema=<schema>`, then run:

```powershell
./mvnw.cmd '-Dtest=AuthConcurrencyTest' `
  '-Dspring.profiles.active=postgres' `
  '-Dspring.datasource.driver-class-name=org.postgresql.Driver' `
  '-Dspring.datasource.username=pantrypal' `
  '-Dspring.datasource.password=pantrypal' `
  '-Dspring.flyway.schemas=<schema>' `
  '-Dspring.flyway.default-schema=<schema>' test
```

These credentials are disposable local examples. Drop only that disposable schema afterward. The test clears auth/inventory data in its configured database, so never point it at application data.

Frontend auth compatibility command, from the repository root:

```powershell
npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app exec tsx --test --test-concurrency=1 src/pages/auth.session.test.tsx
```

The frontend auth/session suite passed all 13 tests. Maven packaging succeeded. Detailed local logs and the one-off live harness are ignored scratch output under `tmp/gs110-*` and `tmp/verify_gs110.py`; the committed regression is independent of that harness. H2 results are reported separately from actual PostgreSQL results.
