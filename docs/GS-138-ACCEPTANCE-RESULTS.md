# Pilot acceptance checks — 10 November 2026

Related: [issue #138](https://github.com/chankiahuja/Grocery-Suggestor/issues/138).

Status: **partial verification; final acceptance remains open**. Automated regression checks and public staging page checks passed. Authenticated PostgreSQL browser flows, verified mail delivery, and the full browser/device matrix remain outstanding.

## Environments

| Check | Environment / revision |
|---|---|
| Automated frontend and backend checks | Local checkout `5dc9ace` on `GS-139`; Java 17.0.12 |
| Public browser checks | `https://pantrypal-staging.onrender.com`; Render reported live commit `29e7f00183e62fea85cc7d0befabe4092c9e7dae` on `GS-134`, Free plan |
| Browser | VS Code integrated browser: Chromium 150.0.7871.250 / Electron 43.8.3 on Windows |
| Viewports | 375 × 900, 390 × 900, 1365 × 900; additional keyboard/form check at 375 × 844 |

These viewport checks emulate screen dimensions; they do not establish acceptance on physical mobile devices, Chrome, Edge, or Safari. Local and deployed revisions differ.

## Automated checks

| Command | Result |
|---|---|
| `npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app typecheck` | Passed |
| `npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app test` | Passed: 103 tests, zero failures, zero skipped |
| From `backend`: `.\mvnw.cmd test` | BUILD SUCCESS: 123 tests, zero failures/errors, two opt-in PostgreSQL tests skipped |

The backend suite uses H2 and does not prove PostgreSQL compatibility. Existing reports from the interrupted session were inspected before the new backend run: both `PostgresAccountOwnershipSmokeTest` and `PostgresRuntimeSmokeTest` recorded one executed test each, zero failures/errors/skips. The prior session ran these against the isolated `pantrypal_auth_test` database. They were not rerun during this continuation. Their service/context-level checks do not substitute for authenticated browser acceptance or a deployed restart test.

The first fresh backend attempt could not access Maven's cache; the successful rerun used approved access. Frontend checks likewise needed approved npm/pnpm cache access. No application changes were needed for these environment restrictions.

## Public staging checks

For each of `/`, `/signup`, `/login`, and `/contact`, fresh page navigation was performed at all three viewport widths (12 combinations):

- All returned HTTP 200 and rendered the expected headings.
- Document width did not exceed viewport width.
- Every image reported complete loading and a nonzero natural width after page loading settled, including the landing hero.
- Contact displayed the unconfigured-support state and disabled **Send message** at every width.

Additional observations:

- `/api/healthz` returned 200.
- `/api/feedback/config` returned `supportEmail: null` and `responseTime: null`.
- Unauthenticated visits to `/dashboard`, `/inventory`, and `/shopping-lists` redirected to `/login`. Reloading the login page rendered its welcome heading successfully.
- Submitting the empty login form displayed “Enter your email address” and marked the email field invalid. No staging OTP was requested.
- Keyboard Tab reached the verification button with a visible focus outline (approximately 2.4 px).
- Labels for the email field and the Contact category, subject, message, and reply-email controls were exposed in the accessibility snapshot.

These are loading, geometry, and focused interaction checks, not a complete accessibility or contrast audit. Feedback delivery is **unverified**, not passed.

## Local authenticated-flow attempt

An existing application on port 8080, PostgreSQL on 5432, and Mailpit on 1025/8025 were available. The existing app was not restarted or reconfigured. Its PostgreSQL profile was not established: the inspected launch command did not name `postgres`, and no connection from that app process to port 5432 was observed. Environment-only profile configuration could not be established from that observation.

Signup used only the disposable address `pilot-138-1794291805224@example.test` and test name `Pilot Acceptance 138`. The UI reached the OTP step and displayed “Code sent.” Resending reached the backend and returned HTTP 200. A search scoped to that exact address found no matching message in Mailpit after both attempts. This establishes neither successful email receipt nor a product defect: the existing app's mail destination/configuration was not verified. No OTP was guessed or bypassed, and no authenticated account or pantry data was created through verification.

## Remaining acceptance work

- Establish an isolated local PostgreSQL application runtime and a verified test mail route, then complete signup, OTP, login, logout, session restoration, and account-menu checks.
- In that runtime, exercise inventory add/edit/consume/restock/Undo, low/out-of-stock and expiry alerts, shopping-list creation and repeat-safe purchase completion through the browser, including narrow layouts.
- Verify feedback acceptance in a configured environment and receipt in the intended test mailbox. Staging currently exposes an explicit unavailable state.
- Repeat the critical flows in desktop Chrome and Edge and the agreed mobile/device matrix; finish keyboard, menu/dialog focus, readability/contrast, and clean-load checks.
- Keep deployed PostgreSQL persistence/restart and secure-cookie verification under issue #134 separate from the local automated results.

No confirmed product defect was established by this run. The unavailable mail configuration and unverified local runtime are acceptance blockers, and issue #138 should remain open.
