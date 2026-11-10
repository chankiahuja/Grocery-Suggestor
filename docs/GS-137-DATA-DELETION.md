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
| Browser | React Query data, adjustment feedback, account-specific notification read markers | Clear queries and current account marker; full navigation unmounts account state. Other tabs/devices clear state when they next discover session revocation; offline browser copies cannot be remotely erased |
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

Before finalizing the public notice or admitting pilot users, record the actual hosting, SMTP, support mailbox and backup/export arrangements. Record provider retention and deletion controls from the configured plan; do not infer a retention period from another plan or environment. The draft privacy page must remain identified as awaiting deployment review until these facts are confirmed.

Account deletion does not remove already-delivered support messages or provider backups. Support must verify the requester, search attributable messages and remove available copies according to the provider controls. Do not send a deletion confirmation email containing a pantry snapshot or keep deleted accounts for analytics.

**Restore procedure:** keep restored databases isolated from traffic and outbound mail. Reconcile every account deletion after the snapshot before enabling the application. This requires an access-controlled operator deletion record outside the restored snapshot, with the minimum identifiers needed to reconcile it, an explicit retention policy, and controlled disposal when all affected backups/exports have expired. This operator record and its policy are not implemented by this change and must be approved and established before using backups for the pilot. If a complete reconciliation record is unavailable, do not serve the restored data. Verify the reconciliation with a disposable-account restore rehearsal and record the outcome. Do not silently restore deleted users or promise immediate backup erasure.

## Verification

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
