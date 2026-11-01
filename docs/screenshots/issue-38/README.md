# Issue #38 screenshot evidence

Captured from implementation commit `4028a0f7a777bd53c9a90b9cfc7d52f10dec06eb` using Playwright with headless Google Chrome, a fresh browser context, and a 1440 x 1100 viewport. The app runs in explicit frontend demo mode with sample browser-storage data; these images do not represent a PostgreSQL integration run.

1. [Adjustment and Undo action](01-adjustment-undo-available.png): consuming one egg changes stock from four to three and immediately exposes Undo.
2. [Undo survives navigation](02-dashboard-undo-after-navigation.png): the dashboard remains accessible with the same Undo action.
3. [Successful Undo](03-undo-success-restored-quantity.png): stock returns to four and the action is replaced by confirmation.
4. [Conflict feedback](04-undo-conflict-feedback.png): editing the item after consumption invalidates Undo and preserves the later state.
5. [Expired feedback](05-undo-expired-feedback.png): Playwright's browser clock advances by 300,001 ms to verify that the five-minute window expires and the action disappears.

All five scenarios were exercised through the rendered UI, with assertions on the resulting feedback and quantity where applicable. No screenshot content was edited.
