import { Router, type IRouter } from "express";
import { eq, lt, and, sql } from "drizzle-orm";
import { db, inventoryItemsTable } from "@workspace/db";
import {
  CreateInventoryItemBody,
  CreateInventoryItemResponse,
  GetInventoryItemParams,
  GetInventoryItemResponse,
  UpdateInventoryItemParams,
  UpdateInventoryItemBody,
  UpdateInventoryItemResponse,
  DeleteInventoryItemParams,
  ListInventoryItemsResponse,
  ListInventoryItemsQueryParams,
  GetInventoryStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/** Drizzle returns Date objects; OpenAPI Zod schemas expect ISO strings. */
function ser<T extends object>(row: T): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])
  ) as T;
}

router.get("/inventory", async (req, res): Promise<void> => {
  const params = ListInventoryItemsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db.select().from(inventoryItemsTable).$dynamic();

  if (params.data.category) {
    query = query.where(eq(inventoryItemsTable.category, params.data.category));
  }

  if (params.data.lowStock === true) {
    query = query.where(
      and(
        sql`${inventoryItemsTable.quantity} <= ${inventoryItemsTable.minThreshold}`
      )
    );
  }

  const items = await query.orderBy(inventoryItemsTable.name);
  res.json(ListInventoryItemsResponse.parse(items.map(ser)));
});

router.get("/inventory/stats", async (req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [items, categoryRows] = await Promise.all([
    db.select().from(inventoryItemsTable),
    db
      .select({
        category: inventoryItemsTable.category,
        count: sql<number>`count(*)::int`,
      })
      .from(inventoryItemsTable)
      .groupBy(inventoryItemsTable.category),
  ]);

  const lowStockCount = items.filter(
    (i) => i.quantity <= i.minThreshold && i.quantity > 0
  ).length;
  const outOfStockCount = items.filter((i) => i.quantity === 0).length;
  const expiringCount = items.filter(
    (i) =>
      i.expiresAt != null && i.expiresAt >= today && i.expiresAt <= sevenDaysFromNow
  ).length;

  res.json(
    GetInventoryStatsResponse.parse({
      totalItems: items.length,
      lowStockCount,
      outOfStockCount,
      expiringCount,
      categoryBreakdown: categoryRows,
    })
  );
});

router.post("/inventory", async (req, res): Promise<void> => {
  const parsed = CreateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [item] = await db
    .insert(inventoryItemsTable)
    .values({
      name: parsed.data.name,
      category: parsed.data.category,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      minThreshold: parsed.data.minThreshold,
      expiresAt: parsed.data.expiresAt ?? null,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  res.status(201).json(CreateInventoryItemResponse.parse(ser(item)));
});

router.get("/inventory/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetInventoryItemParams.safeParse({ id: Number(raw) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, params.data.id));

  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  res.json(GetInventoryItemResponse.parse(ser(item)));
});

router.patch("/inventory/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateInventoryItemParams.safeParse({ id: Number(raw) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.quantity !== undefined) updates.quantity = parsed.data.quantity;
  if (parsed.data.unit !== undefined) updates.unit = parsed.data.unit;
  if (parsed.data.minThreshold !== undefined) updates.minThreshold = parsed.data.minThreshold;
  if (parsed.data.expiresAt !== undefined) updates.expiresAt = parsed.data.expiresAt ?? null;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;

  const [item] = await db
    .update(inventoryItemsTable)
    .set(updates)
    .where(eq(inventoryItemsTable.id, params.data.id))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  res.json(UpdateInventoryItemResponse.parse(ser(item)));
});

router.delete("/inventory/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteInventoryItemParams.safeParse({ id: Number(raw) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [item] = await db
    .delete(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, params.data.id))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
