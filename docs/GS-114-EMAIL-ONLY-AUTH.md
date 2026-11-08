# GS-114: email-only signup and login

Implementation of [issue #114](https://github.com/chankiahuja/Grocery-Suggestor/issues/114).

## Launch behavior

Email is the only offered method on signup and login, in both normal and browser demo mode. There is no single-option method selector, mobile input or country selector in the default UI. The landing page and auth copy advertise email rather than SMS/mobile access. Email OTP request, resend, verification, session restoration and logout retain their existing behavior.

The mobile preview, country selector and validation remain in source. A central flag in [auth-features.ts](../artifacts/grocery-app/src/lib/auth-features.ts) reads `VITE_ENABLE_MOBILE_PREVIEW`, defaulting to false. Set it to the exact string `true` before starting Vite or building the frontend to opt in. A running Vite process must restart after an environment change; a packaged frontend must be rebuilt. See [environment instructions](ENVIRONMENT.md#mobile-preview-opt-in).

Enabling this flag restores only the preserved preview. It does not add SMS delivery or create real mobile-authenticated sessions. In normal mode the existing mobile preview still leaves the user unauthenticated. Demo mode remains a clearly labeled, browser-only preview with code `123456` and no real account creation.

The restriction is checked at method selection, form submission, code request, resend and verification. A stale mobile form is reset to email if the flag becomes disabled. These guards improve UI consistency; frontend state and DOM controls can be modified in developer tools and are not a security boundary. Spring's email validation, unpredictable OTP verification and session authorization remain authoritative. No backend endpoint, REST shape, account data or database schema was changed.

## Account release check

On 2026-11-08 (Asia/Kolkata, UTC+05:30), a read-only transaction inspected the local PostgreSQL database `pantrypal` at `localhost:5432`, schema `public`:

- `accounts` has `id`, required `email`, optional `display_name`, and `created_at`; no phone/mobile identifier column.
- Four accounts exist; zero have a missing/blank email or an identifier lacking `@`.
- The active Spring account creation path validates an email address before inserting the account. The mobile preview does not create accounts.
- The audit transaction was rolled back and no account or pantry data was changed. No account email addresses or other personal records were exported.

This establishes that the inspected local database has no mobile-only accounts represented by this schema. It is not an audit of an uninspected deployment, the default file-backed H2 store, or historical/external account systems.

Before releasing to another environment, confirm the actual account store and any legacy identity source. If real mobile-only accounts exist elsewhere, provide a verified account-linking/recovery path to email or retain their existing working authentication path before applying the restriction. Do not automatically merge accounts, create replacement accounts, or treat the mobile preview as recovery. Existing email accounts continue to sign in with their existing email OTP flow and retain all account-scoped data.

## Verification

From the repository root:

```powershell
npx.cmd pnpm@10.26.1 --filter @workspace/grocery-app exec tsx --test --test-concurrency=1 src/pages/auth.session.test.tsx src/pages/dashboard.inventory.test.tsx
npx.cmd pnpm@10.26.1 build
```

All **57 frontend tests passed**, including default email-only signup/login in normal and demo modes, landing-page copy, request payloads, developer-tools input changes, stale request/resend/verify handlers after disabling mobile, opt-in country selection/validation, and existing session/dashboard workflows. The production build passed, including workspace TypeScript checks. Legacy mobile tests explicitly enable the flag rather than relying on a launch default.

From `backend`, with `JAVA_HOME` set to the installed JDK:

```powershell
./mvnw.cmd '-Dtest=AuthFlowTest' test
```

All **12 backend auth tests passed** on H2, including rejection of the demo code, attempt limits, expiry, account/session handling and CSRF enforcement. This UI-only change adds no PostgreSQL-specific runtime behavior; PostgreSQL was used for the read-only account check above, not represented as a new full backend test run.

Local verification logs are ignored scratch output under `tmp/gs114-*`.
