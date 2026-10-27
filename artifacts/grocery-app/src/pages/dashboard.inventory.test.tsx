import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { InventoryItem, ShoppingListWithItems } from '@workspace/api-client-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  location: { configurable: true, value: dom.window.location },
  history: { configurable: true, value: dom.window.history },
  React: { configurable: true, value: React },
  addEventListener: {
    configurable: true,
    value: dom.window.addEventListener.bind(dom.window),
  },
  removeEventListener: {
    configurable: true,
    value: dom.window.removeEventListener.bind(dom.window),
  },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
  HTMLButtonElement: { configurable: true, value: dom.window.HTMLButtonElement },
  HTMLSelectElement: { configurable: true, value: dom.window.HTMLSelectElement },
  HTMLTextAreaElement: {
    configurable: true,
    value: dom.window.HTMLTextAreaElement,
  },
  Element: { configurable: true, value: dom.window.Element },
  Node: { configurable: true, value: dom.window.Node },
  Event: { configurable: true, value: dom.window.Event },
  MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  CustomEvent: { configurable: true, value: dom.window.CustomEvent },
  KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
  NodeFilter: { configurable: true, value: dom.window.NodeFilter },
  MutationObserver: { configurable: true, value: dom.window.MutationObserver },
  getComputedStyle: { configurable: true, value: dom.window.getComputedStyle },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
});

dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const { cleanup, fireEvent, render, screen, waitFor } = await import(
  '@testing-library/react'
);
const [
  { default: Dashboard },
  { default: Inventory },
  { default: ShoppingLists },
  { default: ShoppingListDetail },
] = await Promise.all([
  import('./dashboard'),
  import('./inventory'),
  import('./shopping-lists'),
  import('./shopping-list-detail'),
]);
const originalFetch = globalThis.fetch;
const timestamp = '2026-10-26T12:00:00.000Z';

class GroceryApiMock {
  items: InventoryItem[] = [];
  shoppingList: ShoppingListWithItems = {
    id: 1,
    name: 'Weekly shop',
    items: [
      {
        id: 1,
        shoppingListId: 1,
        inventoryItemId: 1,
        name: 'Rice',
        category: 'Pantry',
        quantity: 5,
        unit: 'bags',
        purchased: true,
        notes: null,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  private nextInventoryId = 1;

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input.toString(),
      'http://localhost'
    );
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.pathname === '/api/inventory' && method === 'GET') {
      let items = [...this.items];
      if (url.searchParams.get('lowStock') === 'true') {
        items = items.filter(
          (item) => item.quantity > 0 && item.quantity <= item.minThreshold
        );
      }
      return this.json(items);
    }

    if (url.pathname === '/api/inventory' && method === 'POST') {
      const input = this.readBody(init);
      const item: InventoryItem = {
        id: this.nextInventoryId++,
        name: String(input.name),
        category: String(input.category),
        quantity: Number(input.quantity),
        unit: String(input.unit),
        minThreshold: Number(input.minThreshold),
        expiresAt: input.expiresAt ? String(input.expiresAt) : null,
        notes: input.notes ? String(input.notes) : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.items.push(item);
      return this.json(item, 201);
    }

    if (url.pathname === '/api/inventory/stats' && method === 'GET') {
      const today = new Date().toISOString().slice(0, 10);
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      return this.json({
        totalItems: this.items.length,
        lowStockCount: this.items.filter(
          (item) => item.quantity > 0 && item.quantity <= item.minThreshold
        ).length,
        outOfStockCount: this.items.filter((item) => item.quantity === 0).length,
        expiringCount: this.items.filter(
          (item) =>
            item.expiresAt != null &&
            item.expiresAt >= today &&
            item.expiresAt <= sevenDaysFromNow
        ).length,
        categoryBreakdown: [],
      });
    }

    const inventoryItemMatch = url.pathname.match(/^\/api\/inventory\/(\d+)$/);
    if (inventoryItemMatch && method === 'PATCH') {
      const id = Number(inventoryItemMatch[1]);
      const item = this.items.find((candidate) => candidate.id === id);
      if (!item) return this.json({ error: 'Item not found' }, 404);
      Object.assign(item, this.readBody(init), { updatedAt: timestamp });
      return this.json(item);
    }
    if (inventoryItemMatch && method === 'DELETE') {
      const id = Number(inventoryItemMatch[1]);
      this.items = this.items.filter((item) => item.id !== id);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/api/suggestions' && method === 'GET') {
      return this.json([]);
    }

    if (url.pathname === '/api/shopping-lists' && method === 'GET') {
      return this.json([
        {
          id: this.shoppingList.id,
          name: this.shoppingList.name,
          itemCount: this.shoppingList.items.length,
          purchasedCount: this.shoppingList.items.filter((item) => item.purchased)
            .length,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ]);
    }

    if (
      url.pathname === `/api/shopping-lists/${this.shoppingList.id}` &&
      method === 'GET'
    ) {
      return this.json(this.shoppingList);
    }

    if (
      url.pathname === `/api/shopping-lists/${this.shoppingList.id}/purchase` &&
      method === 'POST'
    ) {
      let updatedInventoryItems = 0;
      const purchasedItems = this.shoppingList.items.filter(
        (item) => item.purchased && item.inventoryItemId !== null
      );
      for (const shoppingItem of purchasedItems) {
        const inventoryItem = this.items.find(
          (item) => item.id === shoppingItem.inventoryItemId
        );
        if (!inventoryItem) continue;
        inventoryItem.quantity += shoppingItem.quantity;
        updatedInventoryItems += 1;
      }
      return this.json({
        purchasedCount: purchasedItems.length,
        updatedInventoryItems,
      });
    }

    return this.json(
      { error: `Unhandled mock request: ${method} ${url.pathname}` },
      404
    );
  };

  private readBody(init?: RequestInit): Record<string, unknown> {
    return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  }

  private json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function renderApp() {
  const location = memoryLocation({ path: '/' });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <Router hook={location.hook}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/inventory" component={Inventory} />
            <Route path="/shopping-lists" component={ShoppingLists} />
            <Route path="/shopping-lists/:id" component={ShoppingListDetail} />
          </Switch>
        </Router>
      </QueryClientProvider>
    ),
  };
}

function changeInput(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

async function openInventory() {
  fireEvent.click(screen.getByRole('link', { name: 'Inventory' }));
  await screen.findByRole('heading', { name: 'Inventory' });
}

async function openDashboard() {
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.history.replaceState({}, '', '/');
});

describe('dashboard inventory attention refresh', () => {
  it('shows every dashboard pantry count from the inventory stats response', async () => {
    const api = new GroceryApiMock();
    const expiringDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    api.items = [
      {
        id: 1,
        name: 'Out of stock item',
        category: 'Pantry',
        quantity: 0,
        unit: 'bags',
        minThreshold: 1,
        expiresAt: null,
        notes: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 2,
        name: 'Low stock item',
        category: 'Produce',
        quantity: 1,
        unit: 'units',
        minThreshold: 2,
        expiresAt: null,
        notes: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 3,
        name: 'Expiring item',
        category: 'Dairy',
        quantity: 8,
        unit: 'cartons',
        minThreshold: 2,
        expiresAt: expiringDate,
        notes: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 4,
        name: 'Healthy item',
        category: 'Bakery',
        quantity: 5,
        unit: 'loaves',
        minThreshold: 2,
        expiresAt: null,
        notes: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    globalThis.fetch = api.fetch;
    renderApp();

    assert.equal((await screen.findByTestId('stat-total-items')).textContent?.trim(), '4');
    assert.equal(screen.getByTestId('stat-low-stock').textContent?.trim(), '1');
    assert.equal(screen.getByTestId('stat-out-of-stock').textContent?.trim(), '1');
    assert.equal(screen.getByTestId('stat-expiring').textContent?.trim(), '1');

    assert.ok((await screen.findByTestId('category-attention-pantry')).textContent?.includes('1Out'));
    assert.ok(screen.getByTestId('category-attention-produce').textContent?.includes('1Low'));
    assert.ok(screen.getByTestId('category-attention-dairy').textContent?.includes('1Expiring'));
  });

  it('refreshes category counts after create, edit, shopping-list restock, and delete flows', async () => {
    const api = new GroceryApiMock();
    globalThis.fetch = api.fetch;
    const { queryClient } = renderApp();

    await screen.findByText('Your pantry is in good shape.');

    await openInventory();
    fireEvent.click(screen.getByTestId('button-add-item'));
    await screen.findByTestId('input-item-name');
    changeInput('input-item-name', 'Rice');
    changeInput('input-item-category', 'Grains');
    changeInput('input-item-quantity', '1');
    changeInput('input-item-unit', 'bags');
    changeInput('input-item-threshold', '2');
    fireEvent.click(screen.getByTestId('button-save-item'));

    await waitFor(() => assert.equal(api.items.length, 1));
    await openDashboard();
    const grainsAttention = await screen.findByTestId(
      'category-attention-grains'
    );
    assert.ok(grainsAttention.textContent?.includes('1Low'));
    assert.equal(screen.getByTestId('stat-total-items').textContent?.includes('1'), true);

    await openInventory();
    fireEvent.click(screen.getByTestId('button-edit-1'));
    await screen.findByTestId('dialog-inventory-item');
    assert.equal(
      (screen.getByTestId('input-item-name') as HTMLInputElement).value,
      'Rice'
    );
    changeInput('input-item-category', 'Pantry');
    changeInput('input-item-quantity', '0');
    fireEvent.click(screen.getByTestId('button-save-item'));
    await waitFor(() => {
      assert.equal(api.items[0]?.category, 'Pantry');
      assert.equal(api.items[0]?.quantity, 0);
    });

    await openDashboard();
    assert.equal(screen.queryByTestId('category-attention-grains'), null);
    const pantryOut = await screen.findByTestId('category-attention-pantry');
    assert.ok(pantryOut.textContent?.includes('1Out'));
    assert.equal(screen.getByTestId('stat-out-of-stock').textContent?.includes('1'), true);

    await openInventory();
    fireEvent.click(screen.getByTestId('button-edit-1'));
    await screen.findByTestId('dialog-inventory-item');
    changeInput('input-item-quantity', '4');
    fireEvent.click(screen.getByTestId('button-save-item'));
    await waitFor(() => assert.equal(api.items[0]?.quantity, 4));
    await openDashboard();
    await screen.findByText('Your pantry is in good shape.');
    assert.equal(screen.queryByTestId('category-attention-pantry'), null);

    await openInventory();
    fireEvent.click(screen.getByTestId('button-edit-1'));
    await screen.findByTestId('dialog-inventory-item');
    changeInput('input-item-quantity', '0');
    fireEvent.click(screen.getByTestId('button-save-item'));
    await waitFor(() => assert.equal(api.items[0]?.quantity, 0));

    fireEvent.click(screen.getByRole('link', { name: 'Shopping Lists' }));
    await screen.findByRole('heading', { name: 'Shopping Lists' });
    fireEvent.click(await screen.findByRole('link', { name: /Weekly shop/ }));
    await screen.findByRole('heading', { name: 'Weekly shop' });
    fireEvent.click(screen.getByTestId('button-complete-purchase'));
    await waitFor(() => assert.equal(api.items[0]?.quantity, 5));

    await openDashboard();
    await screen.findByText('Your pantry is in good shape.');
    assert.equal(screen.queryByTestId('category-attention-pantry'), null);

    await openInventory();
    fireEvent.click(screen.getByTestId('button-delete-1'));
    fireEvent.click(await screen.findByTestId('button-confirm-delete'));
    await waitFor(() => assert.equal(api.items.length, 0));
    await openDashboard();
    await screen.findByText('Your pantry is in good shape.');
    assert.equal(screen.getByTestId('stat-total-items').textContent?.includes('0'), true);

    queryClient.clear();
  });
});
