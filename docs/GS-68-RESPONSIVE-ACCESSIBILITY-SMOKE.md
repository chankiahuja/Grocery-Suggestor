# GS-68 responsive and accessibility smoke check

Checked the React mock frontend at `http://127.0.0.1:5173` with its seeded pantry and Weekend groceries list. This is a frontend smoke check; it does not exercise the Spring API or PostgreSQL.

## Browser checks

| Check | Result |
| --- | --- |
| Dashboard, Inventory, Shopping Lists, and Compare Prices at 320, 375, 768, 1024, and 1280 px | No horizontal page scrolling. The main navigation remains visible, including all four links at 320 px. |
| Shopping-list detail at 320 px; landing, login, and signup at 320, 375, and 768 px | No horizontal page scrolling. List item controls and status text remain available. |
| Keyboard from the header brand at 320 px | Tab order: Dashboard, Inventory, Shopping Lists, Compare Prices, Logout, Notifications. Focus has a visible green outline. |
| Notifications | Enter opens the panel; its close button has a name. Escape closes it and returns focus to the bell. |
| Inventory add and delete dialogs at 320 px | Initial focus enters the dialog. Escape closes it and restores focus to the opening button. At 320 × 400 px, the add dialog fits inside the viewport and its form scrolls. |
| Inventory status badges | Statuses use text as well as color. Computed text/background contrast ratios for Out of Stock, Low Stock, Expiring Soon, and In good shape were 5.21, 4.97, 4.57, and 5.54 respectively. |
| Inventory restock feedback | Restocked Milk, confirmed Undo remained reachable with scroll space below the page, then used Undo and confirmed the original quantity returned. |
| Reduced motion | With `prefers-reduced-motion: reduce`, the dialog and page animations are shortened and the dialog remains usable. |

## Automated checks

- `tsx --test src/pages/inventory-adjustments.test.tsx`: 11 passed, including notification keyboard behavior and Undo regression cases.
- `tsx --test --test-name-pattern="shows progress and clearly labels the sample comparison" src/pages/dashboard.inventory.test.tsx`: 1 passed, including shopping-list control names and progress.
- `tsc -p artifacts/grocery-app/tsconfig.json --noEmit`: passed.
- `vite build --config vite.config.ts`: passed. Vite reported existing sourcemap and bundle-size warnings.
