# GS-104: frontend bundle size and route loading

Verified on 2026-11-07 for [issue #104](https://github.com/chankiahuja/pantry-pal/issues/104).

## Measurements

Both measurements use the normal Vite 7.3.6 production mode, with the existing dependencies and default warning threshold.

| Output | Before | After |
| --- | ---: | ---: |
| Main JavaScript, minified | 579.43 kB | 349.94 kB |
| Main JavaScript, gzip | 177.09 kB | 112.66 kB |
| All emitted JavaScript, minified | 579.43 kB | 586.35 kB |
| CSS | 140.26 kB | 140.30 kB |
| Oversized JavaScript chunk warning | Present | Absent |

The main chunk is about 40% smaller. Splitting adds a small amount of aggregate module-loading overhead; users download page-specific code as they visit those pages. The main chunk is also the largest emitted chunk. No warning threshold was raised, and no dependency or lockfile changes were needed.

An inspection of Rollup's `chunk.modules` identified React DOM, application code, Zod, React Hook Form, Tailwind Merge, React Query and shared Radix UI primitives among the largest contributors. Those module `renderedLength` measurements precede final chunk minification and are not individual compressed download sizes. Route-specific forms, validation and UI can be deferred while the common React/query runtime remains available immediately. Installed packages such as Recharts and Framer Motion were not assumed to be active bundle contributors just because they appear in the package manifest.

## Implementation

[App](../artifacts/grocery-app/src/App.tsx) declares each page with a module-scope `React.lazy` dynamic import. Login and signup share the same auth page. The session gate still runs before rendering the selected page, and React Query and adjustment feedback remain mounted above the page boundary.

[RouteLoadingBoundary](../artifacts/grocery-app/src/components/route-loading-boundary.tsx) shows `Loading page…` with `role="status"` while a page is pending. Its error boundary offers `Reload page` when loading fails. Reload preserves the current path and query, and fetches a fresh entry document to recover from a transient network failure or stale deployment chunk. Navigation to another path clears the error boundary. Existing REST contracts, backend behavior and mutation flows are unchanged.

## Checks

- The existing **Frontend: check** task (`npx pnpm@10.26.1 build`) passed the workspace library/app/script TypeScript checks and the production build. The oversized-chunk warning is gone. Existing source-map location diagnostics from four Radix wrapper files still appear; they also appeared in the baseline build and do not fail it.
- `npx pnpm@10.26.1 --filter @workspace/grocery-app test`: **73 passed**, zero failures/skips. This includes auth/session routing, account menu, dashboard counts and filtering, inventory adjustments and Undo, list/purchase behavior, and two new delayed/failed page-loading tests in [the auth/session suite](../artifacts/grocery-app/src/pages/auth.session.test.tsx).
- A fresh headless Chrome session exercised the final production assets through a local static server with history fallback. API responses were stubbed using the existing pantry adapter and synthetic auth responses; these browser checks verify frontend behavior rather than a new Java/PostgreSQL integration run.

The production browser checks passed:

1. A cold landing request loaded its route chunk without fetching auth or private page chunks.
2. An unauthenticated direct inventory URL redirected to login without requesting the inventory chunk. Email verification then loaded the dashboard on demand.
3. Navigation loaded inventory; a restock succeeded, its Undo feedback survived navigation to shopping lists, and Undo restored the original stock.
4. Shopping-list detail loaded and completing a purchase updated inventory.
5. A direct comparison URL loaded its deferred page.
6. An authenticated direct inventory URL and reload preserved stock/category query filters, with no uncaught page errors during the normal flows.
7. Holding the inventory chunk request displayed the loading status; releasing it displayed inventory.
8. Aborting the inventory chunk request displayed recovery controls. Selecting Reload retried successfully at the original filtered URL.

The local bundle inspection and browser harness/logs are ignored scratch files under `tmp/gs104-*`; they are not runtime dependencies. Temporary Playwright tooling was installed there without changing project manifests. No backend code changed, so backend database suites were not rerun for this frontend-only change.
