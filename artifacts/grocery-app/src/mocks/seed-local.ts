import { seedState } from "./pantry-api";

// Explicit local development command: never seed automatically on application startup.
const base = "http://localhost:8080/api";
async function request(path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

try {
  const sample = seedState();
  const inventory = await request("/inventory") as typeof sample.inventory;
  const ids = new Map<number, number>();
  let added = 0;
  for (const item of sample.inventory) {
    let actual = inventory.find(existing => existing.name === item.name && existing.category === item.category);
    if (!actual) {
      const { id, createdAt, updatedAt, ...body } = item;
      actual = await request("/inventory", body);
      added++;
    }
    ids.set(item.id, actual!.id);
  }
  const lists = await request("/shopping-lists") as { id: number; name: string }[];
  for (const sampleList of sample.lists) {
    const actual = lists.find(list => list.name === sampleList.name)
      ?? await request("/shopping-lists", { name: sampleList.name });
    const details = await request(`/shopping-lists/${actual.id}`) as typeof sampleList;
    for (const item of sampleList.items) {
      const inventoryItemId = ids.get(item.inventoryItemId!);
      if (details.items.some(existing => existing.inventoryItemId === inventoryItemId && existing.name === item.name)) continue;
      const { id, shoppingListId, ...body } = item;
      await request(`/shopping-lists/${actual.id}/items`, { ...body, inventoryItemId });
    }
  }
  console.log(`Demo data ready: added ${added} inventory items. Existing items and shopping progress were preserved.`);
} catch (error) {
  console.error("Could not load local demo data. Start Spring Boot on port 8080 first.", error);
  process.exitCode = 1;
}
