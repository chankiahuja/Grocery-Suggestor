import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, shoppingListsTable, shoppingListItemsTable, inventoryItemsTable } from "@workspace/db";
import {
  CreateShoppingListBody,
  CreateShoppingListResponse,
  GetShoppingListParams,
  GetShoppingListResponse,
  DeleteShoppingListParams,
  ListShoppingListsResponse,
  AddShoppingListItemParams,
  AddShoppingListItemBody,
  AddShoppingListItemResponse,
  UpdateShoppingListItemParams,
  UpdateShoppingListItemBody,
  UpdateShoppingListItemResponse,
  DeleteShoppingListItemParams,
  PurchaseShoppingListParams,
  PurchaseShoppingListResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/shopping-lists", async (_req, res): Promise<void> => {
  const lists = await db.select().from(shoppingListsTable).orderBy(shoppingListsTable.createdAt);

  const enriched = await Promise.all(
    lists.map(async (list) => {
      const items = await db
        .select()
        .from(shoppingListItemsTable)
        .where(eq(shoppingListItemsTable.shoppingListId, list.id));
      return {
        ...list,
        itemCount: items.length,
        purchasedCount: items.filter((i) => i.purchased).length,
      };
    })
  );

  res.json(ListShoppingListsResponse.parse(enriched));
});

router.post("/shopping-lists", async (req, res): Promise<void> => {
  const parsed = CreateShoppingListBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [list] = await db.insert(shoppingListsTable).values(parsed.data).returning();
  res.status(201).json(
    CreateShoppingListResponse.parse({ ...list, itemCount: 0, purchasedCount: 0 })
  );
});

router.get("/shopping-lists/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetShoppingListParams.safeParse({ id: Number(raw) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [list] = await db
    .select()
    .from(shoppingListsTable)
    .where(eq(shoppingListsTable.id, params.data.id));

  if (!list) {
    res.status(404).json({ error: "Shopping list not found" });
    return;
  }

  const items = await db
    .select()
    .from(shoppingListItemsTable)
    .where(eq(shoppingListItemsTable.shoppingListId, list.id));

  res.json(GetShoppingListResponse.parse({ ...list, items }));
});

router.delete("/shopping-lists/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteShoppingListParams.safeParse({ id: Number(raw) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [list] = await db
    .delete(shoppingListsTable)
    .where(eq(shoppingListsTable.id, params.data.id))
    .returning();

  if (!list) {
    res.status(404).json({ error: "Shopping list not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/shopping-lists/:id/items", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = AddShoppingListItemParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddShoppingListItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [list] = await db
    .select()
    .from(shoppingListsTable)
    .where(eq(shoppingListsTable.id, params.data.id));

  if (!list) {
    res.status(404).json({ error: "Shopping list not found" });
    return;
  }

  const [item] = await db
    .insert(shoppingListItemsTable)
    .values({
      shoppingListId: params.data.id,
      inventoryItemId: parsed.data.inventoryItemId ?? null,
      name: parsed.data.name,
      category: parsed.data.category,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  res.status(201).json(AddShoppingListItemResponse.parse(item));
});

router.patch("/shopping-lists/:id/items/:itemId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawItemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  const params = UpdateShoppingListItemParams.safeParse({
    id: Number(rawId),
    itemId: Number(rawItemId),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateShoppingListItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.purchased !== undefined) updates.purchased = parsed.data.purchased;
  if (parsed.data.quantity !== undefined) updates.quantity = parsed.data.quantity;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;

  const [item] = await db
    .update(shoppingListItemsTable)
    .set(updates)
    .where(
      eq(shoppingListItemsTable.id, params.data.itemId)
    )
    .returning();

  if (!item) {
    res.status(404).json({ error: "Shopping list item not found" });
    return;
  }

  res.json(UpdateShoppingListItemResponse.parse(item));
});

router.delete("/shopping-lists/:id/items/:itemId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawItemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  const params = DeleteShoppingListItemParams.safeParse({
    id: Number(rawId),
    itemId: Number(rawItemId),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [item] = await db
    .delete(shoppingListItemsTable)
    .where(eq(shoppingListItemsTable.id, params.data.itemId))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Shopping list item not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/shopping-lists/:id/purchase", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = PurchaseShoppingListParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const items = await db
    .select()
    .from(shoppingListItemsTable)
    .where(
      eq(shoppingListItemsTable.shoppingListId, params.data.id)
    );

  const purchasedItems = items.filter((i) => i.purchased && i.inventoryItemId != null);
  let updatedInventoryItems = 0;

  for (const item of purchasedItems) {
    if (item.inventoryItemId == null) continue;
    const [existing] = await db
      .select()
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.id, item.inventoryItemId));
    if (!existing) continue;

    await db
      .update(inventoryItemsTable)
      .set({ quantity: existing.quantity + item.quantity })
      .where(eq(inventoryItemsTable.id, item.inventoryItemId));
    updatedInventoryItems++;
  }

  res.json(
    PurchaseShoppingListResponse.parse({
      purchasedCount: purchasedItems.length,
      updatedInventoryItems,
    })
  );
});

export default router;
