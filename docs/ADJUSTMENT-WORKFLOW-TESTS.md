# Quick-adjustment workflow verification (GS-16.6)

Tracking: [issue #39](https://github.com/chankiahuja/Grocery-Suggestor/issues/39), part of [GS-16](https://github.com/chankiahuja/Grocery-Suggestor/issues/17).

## Coverage

| Area | Automated evidence |
| --- | --- |
| Consume/restock and input validation | `PantryFlowTest` exercises REST success, insufficient stock, missing keys and missing items. `AdjustmentWorkflowTest` extends validation to malformed bodies, non-finite/non-positive amounts, key bounds, fractional amounts and rejection without writes/events. |
| Concurrent adjustments and retry safety | `AdjustmentWorkflowTest` races consume against restock, competing consumes, identical retries and conflicting payloads sharing a key. It checks final quantities, revisions, adjustment history and event counts, plus current-state replay and key scoping per item. |
| Transaction boundaries | `AdjustmentWorkflowTest` checks adjustment rollback releases its key, events wait for commit, and purchase rollback restores all inventory rows and restock markers before a successful repeat-safe retry. |
| Purchase regressions and ownership | `AdjustmentWorkflowTest` races purchase against adjustment and duplicate purchase completion. It checks shopping-list-scoped updates/deletes and excludes unpurchased/unlinked entries. `PantryFlowTest` covers shortage generation, expiry-only exclusion and repeated completion. |
| Undo | `InventoryUndoTest` covers consume/restock restoration, repeated Undo, expiry, invalid/missing/historical records, intervening edits/adjustments/purchases/Undo, quantity returning to its former value, rollback and concurrent Undo. |
| React workflow | `inventory-adjustments.test.tsx` covers rendering with units, fractional/invalid amounts, pending/duplicate submissions, uncertain retries, server rejection and corrected requests, success/error feedback, persistent Undo across navigation, expiry and retries. It checks inventory/filter refresh, dashboard and suggestions, item-detail cache and the visible notification snapshot after restock and Undo without SSE. |
| Browser demo | `pantry-api.test.ts` covers persisted adjustment keys, retry/conflict behavior, Undo outcomes and purchase regression behavior in browser storage. This supplements the Spring tests; it does not establish backend database behavior. |

Concurrent backend tests use separate service transactions on worker threads, a ready/start barrier, bounded waits and executor cleanup. They assert committed database state, rather than relying on timing sleeps.

## Commands

Windows, from `backend` (use the installed JDK path):

```powershell
$env:JAVA_HOME = 'C:/Program Files/Java/jdk-17'
.\mvnw.cmd '-Dtest=AdjustmentWorkflowTest,InventoryUndoTest,PantryFlowTest' test
.\mvnw.cmd test
```

From the repository root:

```powershell
npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app exec tsx --test src/pages/inventory-adjustments.test.tsx
npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app test
npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app typecheck
npx.cmd pnpm@10.26.1 build
```

On platforms without Windows command shims, use `npx` and `./mvnw` instead. The frontend suite uses Node/tsx with JSDOM, browser globals installed before dynamic UI imports, and Wouter's memory location.

## Verified results (2026-11-02)

| Executed check | Result |
| --- | --- |
| `backend`: `.\mvnw.cmd test` with the JDK above | 49 passed, zero failed/errors/skipped; includes 23 cases in the new `AdjustmentWorkflowTest`. |
| Root: `npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app exec tsx --test src/pages/inventory-adjustments.test.tsx` | 10 passed, zero failed/skipped. |
| Root: `npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app test` | 50 passed, zero failed/skipped. |
| Existing VS Code task **Frontend: check**, running `npx pnpm@10.26.1 build` | Workspace TypeScript checks and Vite production build passed. Vite reported sourcemap diagnostics for existing UI components and a bundle-size warning. |
| `git diff --check` | Passed. |

The backend and frontend tests needed approved execution outside the restricted sandbox. Initial sandbox attempts failed before tests ran (Maven home/cache resolution and Node user-account lookup); invoking `npx` directly in the restricted PowerShell also hit script execution policy. Docker was not installed on this machine, and PostgreSQL verification was not performed.

## Scope and environment limits

- The current application has shared household data and no account/household authorization model. Tests enforce existing shopping-list ownership and item-scoped adjustment keys. Cross-household access tests depend on GS-15, as specified in the parent issue; these tests must be added when that authorization model exists.
- Backend tests use H2 in PostgreSQL compatibility mode with the real Flyway migrations. These concurrency results do **not** prove PostgreSQL locking, SQL or migration compatibility. PostgreSQL verification needs a separate test database; never run this suite against a personal or production database.
- React interaction tests use the browser REST adapter with targeted response failures. They verify UI and cache behavior without a running server or SSE connection; Spring integration tests verify server transactions independently.
- Windows PowerShell may block `npx.ps1`; `npx.cmd` avoids changing execution policy. Restricted execution environments may also block Node's user-account lookup or redirect Maven's cache to an unwritable location. In that case, run with approved access to the normal user account/cache and record the restriction in the PR.

The implementation PR should report actual test counts/results, exact commands and any PostgreSQL/environment blockers alongside this coverage map.
