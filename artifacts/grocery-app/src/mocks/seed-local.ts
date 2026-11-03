import { seedState } from "./pantry-api";
import { createInterface } from "node:readline/promises";

// Explicit local development command: never seed automatically on application startup.
const base = "http://localhost:8080/api";
let seedCookie = "";
let seedCsrf = "";
async function authenticatedSeedSession() {
  const inbox = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const session = await fetch(`${base}/auth/session`, { signal: AbortSignal.timeout(10000) });
    if (!session.ok) throw new Error(`Session setup failed: HTTP ${session.status}`);
    seedCookie = session.headers.getSetCookie().find(value => value.startsWith("PANTRYPAL_SESSION="))?.split(";", 1)[0] ?? "";
    seedCsrf = ((await session.json()) as { csrfToken: string }).csrfToken;
    const email = (process.env.DEMO_SEED_EMAIL || await inbox.question("Email for local demo seeding: ")).trim();
    const challengeResponse = await fetch(`${base}/auth/code`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": seedCsrf, Cookie: seedCookie },
      body: JSON.stringify({ email, intent: "login" }), signal: AbortSignal.timeout(10000),
    });
    if (!challengeResponse.ok) throw new Error(`Code request: HTTP ${challengeResponse.status} ${await challengeResponse.text()}`);
    const challenge = (await challengeResponse.json()) as { challengeId: string };
    const code = (await inbox.question("Enter the code from Mailpit (http://localhost:8025): ")).trim();
    const verify = await fetch(`${base}/auth/verify`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": seedCsrf, Cookie: seedCookie },
      body: JSON.stringify({ email, challengeId: challenge.challengeId, code }), signal: AbortSignal.timeout(10000),
    });
    if (!verify.ok) throw new Error(`Code verification: HTTP ${verify.status} ${await verify.text()}`);
    seedCookie = verify.headers.getSetCookie().find(value => value.startsWith("PANTRYPAL_SESSION="))?.split(";", 1)[0] ?? seedCookie;
    seedCsrf = ((await verify.json()) as { csrfToken: string }).csrfToken;
  } finally { inbox.close(); }
}
async function request(path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": seedCsrf, Cookie: seedCookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

try {
  await authenticatedSeedSession();
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
