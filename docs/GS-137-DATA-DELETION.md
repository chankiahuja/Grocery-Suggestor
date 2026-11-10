# Account deletion and privacy readiness

Scope: [issue #137](https://github.com/chankiahuja/Grocery-Suggestor/issues/137). Provider verification, mailbox cleanup and a restore rehearsal remain release gates; implementing active-store deletion does not establish those outcomes.

## Data inventory

| Store | Data and ownership | Deletion handling |
|---|---|---|
| `accounts` | Name, email, creation date, account ID | Delete account row; no dormant account or analytics copy |
| `inventory_items` | Account-owned stock, notes, expiry, revisions | Delete owned rows |
| `inventory_adjustments` | Stock history, retry keys, Undo metadata linked to inventory | Existing foreign-key cascade deletes history |
| `shopping_lists`, `shopping_list_items` | Owned lists, item quantities/notes, purchased/restocked flags | Delete owned rows and list children before inventory |
| `email_challenges` | Email, optional signup name, hashed OTP, expiry, attempts | Delete matching email row; delayed mail completion cannot activate a removed challenge |
| `auth_rate_limits` | SHA-256-derived email/IP bucket identities | Delete request/verify email buckets; shared IP abuse counters cannot be attributed to one account and remain |
| `spring_session`, `spring_session_attributes` | Account principal, security context, CSRF and recent-auth timestamp | Delete all principal sessions; attributes cascade; invalidate current request session |
| Process memory | Notification subscribers, account alert snapshot, queued mail work | Disconnect subscribers and drop snapshot after commit; queued mail may already be in flight but cannot restore the removed challenge |
| Browser | React Query data, adjustment feedback, account-specific notification read markers | The browser completing deletion clears queries and attempts to remove its account-specific notification read marker; full navigation unmounts account state. Other devices clear signed-in state and the query cache when they detect session revocation, but their notification read markers in localStorage may remain until site data is cleared. Tabs sharing the deleting browser's localStorage share its marker removal, but another open tab with cached suggestions can recreate the markers when its notification panel is opened. These markers can therefore remain even in the browser used to delete the account. Displayed or offline browser copies cannot be remotely erased |
| Wishlist/preferences | No separate persistent wishlist or preference table in the active Spring schema | Do not claim storage that does not exist; reassess when implemented |
| Feedback/support email | Submitted text, optional reply email and mail-provider metadata | Not stored in the application database. Operator must locate and remove attributable mailbox/provider copies; anonymous feedback may not be attributable |
| Logs, exports, backups | Provider-dependent access logs and possible historical snapshots | Must be inspected and handled by the operator; application deletion cannot promise immediate erasure here |

Shopping-list purchase/restock flags and stock adjustment history exist. PantryPal has no separate grocery-order, payment or receipt-tracking system. Wording must preserve this distinction.

## Deletion protocol

- `GET /api/account/deletion-status` requires authentication and reports whether this session verified an email OTP within the last five minutes. Sessions created before this feature require fresh verification.
- `DELETE /api/account` requires authentication, CSRF and that same server-side recent-authentication check. It never accepts an account ID or email supplied by the caller.
- Fresh verification uses the existing login code/verify API for the signed-in email, rotates the session and CSRF token, and records verification time on the server.
- Database deletion is one transaction. Authentication and deletion acquire the email-challenge lock before the account lock. Pantry mutations acquire the account lock before modifying records, preventing new owned writes from surviving a concurrent deletion.
- The transaction removes active account data and all stored sessions. After commit, notification subscribers and snapshots are removed. V7 links authenticated session principals to account string IDs with a foreign key, rejecting stale session saves after deletion; the API filter also rejects stale or imported authentication state whose account no longer exists.
- Success is HTTP 204. Failed database transactions roll back. A retry cannot delete another account or recreate the old one. Once the session is revoked, a repeated request is rejected with 401/403; this is not a second successful deletion response.
- A timeout/lost response is an uncertain result. The frontend must not claim either deletion success or an active intact account without confirmation. Recheck sign-in state and contact support if needed.
- A person can explicitly sign up again later with the same email; this creates a new account ID and does not recover old data.

V7 adds an internal unique string representation of the account ID and a cascading foreign key from authenticated Spring Session principals. Existing account references are backfilled and legacy sessions with no account are invalidated. New accounts receive the string reference in the verification transaction before a session can be saved. Applied migrations are unchanged.

## Provider and restore release gates

### Current staging provider check — 10 November 2026

The checked-in Render Blueprint currently selects a **Free** web service and a **Free** Render PostgreSQL database. Render's current Free-instance documentation says:

- Free web services cannot send outbound traffic on ports 25, 465 or 587. The production configuration's default Brevo SMTP endpoint uses port 587, so OTP and support-email delivery cannot work on this plan even after credentials are added.
- Free Render PostgreSQL databases do not support any form of backup or managed export, expire after 30 days, and are deleted after the documented grace period. There is therefore no Render-managed backup to reconcile in the current staging configuration. This is not a durability guarantee and must be re-evaluated before changing the database plan or creating a self-managed export.
- The web-service filesystem is ephemeral and is not an application data store.

Brevo's current documentation says transactional logs and email previews are retained without a time limit by default unless a custom retention rule is configured. Individual transactional logs can be manually deleted; Brevo says queued deletion can take up to 72 hours. The actual PantryPal Brevo account settings have not been inspected, so neither a retention period nor completed deletion can be claimed yet.

Before enabling email sign-in for the pilot, choose and verify one supported delivery path: upgrade the Render web service to a plan that permits authenticated SMTP, or implement and review an HTTPS mail-provider transport. Do not put API keys or SMTP credentials in the repository. After choosing the path, verify OTP delivery, feedback delivery to `support@mypantrypal.in`, the configured Brevo retention rule, and manual log deletion with disposable test data.

Before finalizing the public notice or admitting pilot users, record the actual hosting, SMTP, support mailbox and backup/export arrangements. Record provider retention and deletion controls from the configured plan; do not infer a retention period from another plan or environment. The draft privacy page must remain identified as awaiting deployment review until these facts are confirmed.

Account deletion does not remove already-delivered support messages or provider backups. Support must verify the requester, search attributable messages and remove available copies according to the provider controls. Do not send a deletion confirmation email containing a pantry snapshot or keep deleted accounts for analytics.

### Restore procedure — invalidate authentication before serving traffic

For the full PostgreSQL export/restore drill, measured local recovery checks and remaining production backup requirements, see the [backup and recovery runbook](GS-136-BACKUP-RESTORE.md).

Track the authentication restore requirement in [issue #145](https://github.com/chankiahuja/Grocery-Suggestor/issues/145). A snapshot can contain a session subsequently logged out or a challenge subsequently consumed. Account-existence checks and V7's session foreign key cannot detect these reversals for accounts that still exist. An unchanged OTP secret can make a restored code usable until its original expiry. Rotating an OTP secret alone does not revoke restored session cookies.

1. Stop **all application instances and mail workers** before restoring. Keep the restored database isolated from user traffic and outbound mail. Restrict database access to the recovery operator so no old process can save an in-memory session or activate queued authentication work during cleanup.
2. Verify the destination database and schema explicitly. Restore the intended snapshot, then reconcile **every account deletion after the snapshot** before enabling the application. This requires an access-controlled operator deletion record outside the restored snapshot, with the minimum identifiers needed to reconcile it, an explicit retention policy, and controlled disposal when all affected backups/exports have expired. This operator record and its policy are not implemented by this change and must be approved and established before using backups for the pilot. If a complete reconciliation record is unavailable, **do not serve the restored data**.
3. Invalidate **all restored sessions and email challenges**, including those for accounts that remain. Execute the [operator-only cleanup SQL](../backend/src/main/resources/db/operations/invalidate_restored_auth.sql) against the verified restored schema while every application instance and worker remains stopped:

   ```sql
   BEGIN;
   DELETE FROM spring_session;
   DELETE FROM email_challenges;
   COMMIT;
   ```

   Deleting sessions cascades to `spring_session_attributes`, removing stored authentication contexts, CSRF tokens and recent-verification timestamps. Retain the abuse-prevention counters in `auth_rate_limits`. The cleanup is repeat-safe while the target remains offline. If any statement fails, roll back and resolve the failure; keep traffic disabled.
4. Before starting any instance, verify that `spring_session`, `spring_session_attributes` and `email_challenges` are empty. Verify deletion reconciliation separately. Stop recovery if either check fails. Record the recovery target, time and outcomes without recording cookies, OTPs or other credentials.
5. Start fresh application processes after cleanup; never reuse a process carrying pre-restore session state or queued mail work. Use restricted access and disposable test accounts to confirm that a cookie revoked after the snapshot is unauthorized, a previously consumed code cannot verify, and a newly requested code permits fresh sign-in. Reopen traffic only after those checks pass. All users must sign in again after recovery.

This is an explicit recovery operation, not a Flyway migration or a normal-startup hook. Normal restart persistence stays intact. Verify the complete procedure with a disposable-account restore rehearsal and record the outcome. Do not silently restore deleted users or promise immediate backup erasure.

### Restore regression database safety

`RestoredAuthenticationTest` registers `RestoreAuthDatabaseGuard` as a Spring context initializer. It validates the resolved `spring.datasource.url` before context refresh, datasource bean creation or Flyway initialization. Only in-memory H2 is allowed automatically. PostgreSQL, file-backed H2 and other targets require the explicit test-only opt-in `RESTORE_AUTH_ALLOW_EXTERNAL_DATABASE=true`; without it, startup fails before database initialization. Error messages omit the URL because it may contain credentials.

The initializer also checks the relaxed-bound `spring.datasource.hikari.jdbc-url` override. If configured, it must exactly match the selected `spring.datasource.url`, including `currentSchema`; a conflict blocks startup even with external access enabled. Remove conflicting ambient Hikari settings rather than enabling opt-in to bypass them.

The opt-in acknowledges destructive test operations; it **does not create a schema or verify isolation**. For PostgreSQL, create a unique temporary schema inside the isolated `pantrypal_auth_test` database first, then explicitly select it with `currentSchema`. Never select a shared schema, the normal app database or production. From `backend`, with disposable test credentials:

```powershell
$env:RESTORE_AUTH_DB_URL = 'jdbc:postgresql://localhost:5432/pantrypal_auth_test?currentSchema=pp_restore_<unique_id>'
$env:RESTORE_AUTH_DB_USER = '<test database user>'
$env:RESTORE_AUTH_DB_PASSWORD = '<test database password>'
$env:RESTORE_AUTH_ALLOW_EXTERNAL_DATABASE = 'true'
try {
    .\mvnw.cmd '-Dtest=RestoredAuthenticationTest' test
} finally {
    Remove-Item Env:RESTORE_AUTH_ALLOW_EXTERNAL_DATABASE
    Remove-Item Env:RESTORE_AUTH_DB_URL
    Remove-Item Env:RESTORE_AUTH_DB_USER
    Remove-Item Env:RESTORE_AUTH_DB_PASSWORD
}
```

After the test process exits, remove only the temporary schema created for that run, including after a failed run. Keep the opt-in scoped to this one invocation. A lifecycle-method check such as `@BeforeEach` is too late: Spring can initialize the datasource and run migrations before any test method executes.

Guard verification on 10 November 2026, branch `GS-146`:

- `.\mvnw.cmd '-Dtest=RestoreAuthDatabaseGuardTest,RestoredAuthenticationTest' test`: **eight passed** with default in-memory H2 (seven guard checks plus the restore regression).
- The same command with explicit external opt-in and a newly created temporary PostgreSQL schema in `pantrypal_auth_test`: **eight passed on PostgreSQL 17.11**. The temporary schema was dropped afterward.
- A separate invocation of the real `RestoredAuthenticationTest` with a dummy external URL and opt-in disabled failed at the registered initializer as expected, before Hikari startup. No connection to that dummy target was attempted.
- Guard checks exercise resolved URL placeholders, direct datasource property overrides, persistent H2 rejection, explicit external opt-in, and credential-free guard errors. Datasource and Flyway bean probes remain uncreated for rejected targets. Frontend checks were not rerun because this change affects only tests and documentation.

Hikari override follow-up verification on 10 November 2026:

- `.\mvnw.cmd '-Dtest=RestoreAuthDatabaseGuardTest,RestoredAuthenticationTest' test`: **13 passed** (12 guard checks and the H2 restore regression). New checks use `DataSourceAutoConfiguration` with real Hikari binding: conflicting URLs are blocked before datasource initialization with opt-in both disabled and enabled, including a redirect from the selected PostgreSQL schema to another schema. Matching URLs preserve Hikari's selected target. Guard errors omit connection details.
- `.\mvnw.cmd '-Dtest=RestoredAuthenticationTest' "-Dspring.datasource.hikari.jdbc-url=$restoreTestUrl" test`, with `$restoreTestUrl` and `RESTORE_AUTH_DB_URL` set to the same newly created temporary schema in `pantrypal_auth_test` and external opt-in enabled: **one passed on PostgreSQL 17.11**. All seven migrations applied to the selected schema; the temporary schema was dropped afterward. Hikari auto-configuration unit checks do not open external connections; this separate run verifies the actual PostgreSQL workflow.
- The initial sandboxed Maven invocation could not access its local repository; the same focused command passed with the required repository access. Frontend checks were not rerun because no frontend behavior changed.

## Verification

For issue #145, `RestoredAuthenticationTest` snapshots and restores only the three authentication tables in an isolated database/schema, with mocked mail delivery and a stable test OTP secret. Its control confirms that the unexpired logged-out cookie and consumed code become usable after restoring the snapshot. It then restores the same snapshot, executes the operator SQL twice, verifies removal of sessions/attributes/challenges, rejects both old credentials, and permits a fresh email login while accounts remain intact.

Checks on 10 November 2026, branch `GS-145`:

- From `backend`, `.\mvnw.cmd '-Dtest=RestoredAuthenticationTest,AuthFlowTest' test`: **20 passed** against isolated H2 databases.
- `.\mvnw.cmd '-Dtest=RestoredAuthenticationTest' test` with `RESTORE_AUTH_DB_URL`, `RESTORE_AUTH_DB_USER`, and `RESTORE_AUTH_DB_PASSWORD` targeting a newly created temporary schema in `pantrypal_auth_test`: **one passed on PostgreSQL 17.11**; seven Flyway migrations validated/applied; the temporary schema was dropped afterward. Subsequent runs also require `RESTORE_AUTH_ALLOW_EXTERNAL_DATABASE=true`, as described above. These variables are test-only overrides and must never target the normal app or production database.
- `git diff --check`: passed. No frontend behavior changed, so frontend checks were not rerun.

This verifies authentication-table restore semantics through the real authentication controllers and JDBC sessions. It is not a provider backup restore rehearsal, a full database/process recovery, or a real email delivery test. The operator must still verify account-deletion reconciliation and the complete isolated recovery procedure before serving restored data.

Focused backend tests cover associated data cleanup, all-session revocation, pending-code invalidation, repeated requests, CSRF, stale authentication with fresh OTP recovery, two-account isolation, deletion racing with a write, and rollback with a forced foreign-key failure. Notification tests check closure of every deleted-account stream and suppression of queued signals without closing another account's stream. The opt-in PostgreSQL runtime smoke checks account-data deletion after restart and rejection of a stale session insert by the V7 foreign key.

Results on 10 November 2026, working branch `GS-137`:

| Check | Outcome |
|---|---|
| Backend `.\mvnw.cmd test` | Final run: 134 tests, zero failures/errors, two opt-in PostgreSQL tests skipped |
| `.\mvnw.cmd '-Dtest=AuthConcurrencyTest' test` | Eight passed with the unchanged two-connection pool and 100-user burst |
| `.\mvnw.cmd '-Dtest=PostgresRuntimeSmokeTest' test` with opt-in enabled | Passed on PostgreSQL 17.11 in a unique temporary schema in `pantrypal_auth_test`; seven migrations validated/applied, restart/deletion checks passed, schema removed |
| `npx.cmd pnpm@10.26.1 --filter @workspace/api-spec codegen` | Generated React client and Zod types; library typecheck passed |
| `npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app typecheck` | Passed |
| `npx pnpm@10.26.1 build` via the Frontend: check task | Final build and workspace typechecks passed; Vite emitted sourcemap warnings for existing UI components |
| `npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app test` | Existing 103-test regression run passed before the five new account/privacy tests were added |
| `npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app exec tsx --test src/pages/auth.session.test.tsx` | Final focused run: 31 passed, including the five new account/privacy tests |

One earlier full backend run encountered a 30-second pool-acquisition timeout during the 100-user inventory-write phase while frontend checks were also running. Both the isolated unchanged concurrency test and a subsequent full suite passed. The cause was not confirmed; do not treat the reruns as proof that concurrency can never time out. Pool size and timeout assertions were not weakened.

The integrated Chromium browser exercised account settings and the draft privacy page at 375, 390 and 1365 px (height 844): no document overflow; confirmation dialogs fit; Escape/cancel restored trigger focus; simulated HTTP 500 deletion failures retained an explicit uncertain-outcome message and retry path. These browser checks used intercepted API responses, not a live PostgreSQL deletion. Browser routes were removed after testing. Simulated SSE JSON responses and HTTP 500 responses in this pass were test fixtures, not observed server defects.

The Java debug launcher failed its Maven build before starting the separate local acceptance runtime. No automatic relaunch was attempted. The tool did not provide the underlying terminal diagnostic, so this launch failure was not conclusively diagnosed. Independent Maven builds/tests passed. Full browser OTP-to-deletion with actual email receipt, deployed support delivery, real Chrome/Edge/device coverage and the backup restore rehearsal remain unverified. H2 results do not replace the separate PostgreSQL result above.
