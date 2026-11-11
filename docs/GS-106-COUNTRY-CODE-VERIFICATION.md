# GS-106: country calling codes in mobile preview

Implemented using [the supplied reference folder](../pantry-pal-country-code-frontend-files) for [issue #106](https://github.com/chankiahuja/pantry-pal/issues/106).

## Behavior

- Both login and signup show a native, keyboard-operable country selector when Mobile number is selected. India (+91) is the default.
- [The country list](../artifacts/grocery-app/src/lib/phone-countries.ts) uses a region identifier as each option's value. Countries sharing a calling code, such as Canada and the United States, remain distinct selections. Each option contains its country name and calling code.
- The selected country survives login/signup navigation, switching between email and mobile, and returning from verification to edit the number. The verification summary uses the selected calling code.
- The field hint repeats the country and code so the code remains visible when a long native select label is clipped on a narrow screen.
- Empty input requests a number. India requires ten digits. Other countries use the reference's permissive four-to-fourteen-digit basic check; country codes, spaces, punctuation and letters receive clear digits-only feedback. This is a preview format check, not country-specific mobile-number verification.
- Overlong numbers are validated rather than silently truncated. The reference's `maxLength` attribute was omitted for that reason.
- Email authentication is unchanged. Mobile preview sends no SMS and does not create an authenticated session in full-stack mode.

Only relevant runtime changes were integrated from the reference. Its unrelated, older routing and test-initialization changes were excluded. The supplied reference folder was left unchanged.

## Verification

- `npx pnpm@10.26.1 --filter @workspace/grocery-app test`: **78 passed**, no failures or skips. Added coverage includes defaults and selected-code summaries on both routes, separate shared-code selections, persistence across navigation and method changes, invalid Indian/international input, and absence of mobile authentication requests. Existing email, routing, pantry, purchase and Undo tests passed.
- The existing **Frontend: check** task (`npx pnpm@10.26.1 build`) passed workspace TypeScript checks and the production build. The main JavaScript chunk remains 349.94 kB; the auth chunk is 13.21 kB. There is no oversized-chunk warning. The existing source-map location diagnostics for four UI wrappers still appear without failing the build.
- Fresh headless Chrome contexts tested the production assets at widths **1440, 390 and 320 pixels**. Native Shift+Tab, End, ArrowUp and Tab operations changed selection and moved focus correctly. The country selector had its accessible combobox name; number and selector bounds stayed within the viewport, with no horizontal overflow. These semantic/keyboard checks did not include a manual screen-reader session.
- At every width, Canada and the United States remained distinct choices; selection survived login/signup and verification/back navigation; verification displayed the selected code; and mobile preview made no `/api/auth/code` or `/api/auth/verify` request. There were no uncaught page errors. Browser tests used synthetic session responses and the existing pantry API adapter, not a new backend integration run.

Local browser harnesses, logs and screenshots live under ignored `tmp/gs106-*` and `tmp/gs104-browser/`. No backend, REST contract, project dependency or lockfile changes were required.
