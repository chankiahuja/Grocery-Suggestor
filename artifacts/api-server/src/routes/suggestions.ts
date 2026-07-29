import { Router, type IRouter } from "express";
import { db, inventoryItemsTable } from "@workspace/db";
import { GetGrocerySuggestionsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/suggestions", async (req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const items = await db.select().from(inventoryItemsTable);

  type Urgency = "critical" | "low" | "expiring_soon";

  const suggestions: {
    inventoryItemId: number | null;
    name: string;
    category: string;
    currentQuantity: number;
    minThreshold: number;
    unit: string;
    reason: string;
    urgency: Urgency;
  }[] = [];

  for (const item of items) {
    if (item.quantity === 0) {
      suggestions.push({
        inventoryItemId: item.id,
        name: item.name,
        category: item.category,
        currentQuantity: item.quantity,
        minThreshold: item.minThreshold,
        unit: item.unit,
        reason: `Out of stock`,
        urgency: "critical",
      });
    } else if (item.quantity <= item.minThreshold) {
      suggestions.push({
        inventoryItemId: item.id,
        name: item.name,
        category: item.category,
        currentQuantity: item.quantity,
        minThreshold: item.minThreshold,
        unit: item.unit,
        reason: `${item.quantity} ${item.unit} left (minimum is ${item.minThreshold} ${item.unit})`,
        urgency: "low",
      });
    } else if (
      item.expiresAt != null &&
      item.expiresAt >= today &&
      item.expiresAt <= sevenDaysFromNow
    ) {
      suggestions.push({
        inventoryItemId: item.id,
        name: item.name,
        category: item.category,
        currentQuantity: item.quantity,
        minThreshold: item.minThreshold,
        unit: item.unit,
        reason: `Expires on ${item.expiresAt}`,
        urgency: "expiring_soon",
      });
    }
  }

  // Sort: critical first, then low, then expiring
  const urgencyOrder: Record<Urgency, number> = { critical: 0, low: 1, expiring_soon: 2 };
  suggestions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  res.json(GetGrocerySuggestionsResponse.parse(suggestions));
});

export default router;
