---
name: JSDOM UI tests
description: Environment constraints when rendering the grocery app's React UI under the Node test runner.
---

When testing app pages with `tsx --test`, initialize JSDOM and expose the browser globals before dynamically importing UI modules. Use Wouter's memory-location hook so route changes work without the browser History API.

**Why:** Radix dialogs and focus management rely on DOM constructors at runtime, and Wouter's browser location hook relies on browser globals. Importing UI modules before setting up JSDOM or using an incomplete DOM shim causes misleading interaction failures.

**How to apply:** Import `@testing-library/react` and page modules after the JSDOM globals are installed; expose JSDOM's event and element constructors on `globalThis`, and render routes with `memoryLocation`.
