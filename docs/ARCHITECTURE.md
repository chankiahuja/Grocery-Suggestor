# Architecture

The `/login` and `/signup` routes are frontend-only email-or-mobile/OTP design previews with scoped styling. Signup includes a required name held only in the form; it is cleared on success/navigation and never displayed in the workspace or persisted. They share a React component and in-memory form state, use no authentication API, and never persist email addresses or phone numbers or establish a session. A valid demo OTP clears the identifier/code and navigates straight to `/dashboard`, without an intermediate success screen. Every fresh page load replaces the initial URL with `/login` before rendering app screens. A memory-only preview gate allows app navigation after the demo code succeeds; reloading resets it. The dashboard lives at `/dashboard`. Unknown extensionless page URLs serve the React entry point, while missing APIs and assets retain 404s. This does not authenticate users or protect API access. Real OTP verification and accounts are a separate integration.

An optional `dev:mock` frontend mode loads a browser-side REST adapter before React starts. It seeds relative-date pantry examples, persists demo edits in localStorage, and supports the existing inventory/suggestions/shopping flows. It does not connect to Spring, PostgreSQL or SSE. Normal development uses the architecture below.

```text
Browser -> Spring Boot embedded server :8080
             |-- React static assets + client routes
             |-- /api -> JDBC -> H2 file (local default)
                               PostgreSQL :5432 (postgres profile)
                    |
            committed PantryChanged events
                    |
             SSE -> React Query refresh
```

The frontend production build is included in the Spring classpath and executable JAR by Maven resources. `pnpm start` builds it before launching Spring; the Docker multi-stage build does both. Explicit client routes forward to `index.html`, while API endpoints and missing asset requests retain their normal HTTP behavior. Optional Vite development on :5173 proxies `/api` to Spring for hot reload.

[OpenAPI](../lib/api-spec/openapi.yaml) describes the existing REST contract. Keep generated React hooks compatible. The additive SSE endpoint uses `pantry-event` events with `{ "type": "inventory_changed" | "purchase_completed" | "alerts_changed" | "heartbeat" }`; `ready` confirms connection.

The controller owns HTTP routing, the service owns validation and transactions, and the repository owns parameterized SQL and camelCase serialization. SQL identifiers are an internal allowlist. Flyway owns the new database schema.

Inventory changes and completed purchases publish Spring application events. Transactional listeners notify browsers only after commit. A scheduled check detects changes in current stock/expiry suggestions; heartbeats keep idle connections active. Browser EventSource reconnects automatically. The notification bell retains its 30-second snapshot polling as fallback.

Rules use UTC dates: zero quantity is critical; positive quantity at/below threshold is low; expiry today through seven days ahead is expiring soon. Suggestions choose one reason per item, in that priority order. Category attention can count both stock and freshness problems for an item. Expiry-only reminders do not generate purchases.

Purchases lock the list, atomically increase linked inventory, and mark rows as restocked in one transaction. Repeating completion skips already applied rows. Unlinked manual shopping items do not create pantry records automatically. Item changes are scoped to the supplied shopping-list ID.

No broker, authentication, email delivery, deployment platform or production hardening is part of this prototype. Historical Express/Drizzle sources are reference material, not runtime dependencies.

Consume/restock adjustments require an `Idempotency-Key` and retain their existing inventory-item response. `POST /api/inventory/{id}/undo` accepts `{ "idempotencyKey": "original-key" }` for that item. Undo restores only the recorded prior quantity within five minutes; any intervening edit, adjustment, undo or purchase invalidates it, even if quantity returns to the same value. Every inventory update atomically increments an internal revision, excluded from public inventory responses. V3 adds revision and undo metadata without making historical V2 adjustments eligible. Row locking serializes undo with all inventory writes; stock, revision and undo marker commit together. Successful undo returns `status: undone` and current `inventory`; retries return `already_undone` and current inventory without another write or event, even after expiry. Invalid input returns 400, missing item/key 404, conflict or historical record 409, and expiry 410. Notifications retain the existing after-commit path.
