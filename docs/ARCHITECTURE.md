# Architecture

The `/login` and `/signup` routes are frontend-only mobile/OTP design previews with scoped styling. They share a React component and in-memory form state, use no authentication API, and never store phone numbers or establish a session. Existing app routes remain accessible. Real OTP verification and accounts are a separate integration.

An optional `dev:mock` frontend mode loads a browser-side REST adapter before React starts. It seeds relative-date pantry examples, persists demo edits in localStorage, and supports the existing inventory/suggestions/shopping flows. It does not connect to Spring, PostgreSQL or SSE. Normal development uses the architecture below.

```text
React / TypeScript :5173
  /api proxy -> Spring Boot :8080 -> JDBC -> PostgreSQL :5432
                    |
            committed PantryChanged events
                    |
             SSE -> React Query refresh
```

[OpenAPI](../lib/api-spec/openapi.yaml) describes the existing REST contract. Keep generated React hooks compatible. The additive SSE endpoint uses `pantry-event` events with `{ "type": "inventory_changed" | "purchase_completed" | "alerts_changed" | "heartbeat" }`; `ready` confirms connection.

The controller owns HTTP routing, the service owns validation and transactions, and the repository owns parameterized SQL and camelCase serialization. SQL identifiers are an internal allowlist. Flyway owns the new database schema.

Inventory changes and completed purchases publish Spring application events. Transactional listeners notify browsers only after commit. A scheduled check detects changes in current stock/expiry suggestions; heartbeats keep idle connections active. Browser EventSource reconnects automatically. The notification bell retains its 30-second snapshot polling as fallback.

Rules use UTC dates: zero quantity is critical; positive quantity at/below threshold is low; expiry today through seven days ahead is expiring soon. Suggestions choose one reason per item, in that priority order. Category attention can count both stock and freshness problems for an item. Expiry-only reminders do not generate purchases.

Purchases lock the list, atomically increase linked inventory, and mark rows as restocked in one transaction. Repeating completion skips already applied rows. Unlinked manual shopping items do not create pantry records automatically. Item changes are scoped to the supplied shopping-list ID.

No broker, authentication, email delivery, deployment platform or production hardening is part of this prototype. Historical Express/Drizzle sources are reference material, not runtime dependencies.
