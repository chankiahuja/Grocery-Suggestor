import { Router, type IRouter } from "express";
import {
  db,
  inventoryItemsTable,
  shoppingListsTable,
  shoppingListItemsTable,
  type InventoryItem,
} from "@workspace/db";
import {
  GenerateShoppingListFromSuggestionsResponse,
  GetGrocerySuggestionsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type Urgency = "critical" | "low" | "expiring_soon";

type GrocerySuggestion = {
  inventoryItemId: number | null;
  name: string;
  category: string;
  currentQuantity: number;
  minThreshold: number;
  unit: string;
  reason: string;
  urgency: Urgency;
};

function getSuggestions(items: InventoryItem[]): GrocerySuggestion[] {
  const today = new Date().toISOString().split("T")[0];
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const suggestions: GrocerySuggestion[] = [];

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

  return suggestions;
}

/** Drizzle returns Date objects; OpenAPI Zod schemas expect ISO strings. */
function serializeDates<T extends object>(row: T): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ])
  ) as T;
}

router.get("/suggestions", async (_req, res): Promise<void> => {
  const items = await db.select().from(inventoryItemsTable);
  const suggestions = getSuggestions(items);

  res.json(GetGrocerySuggestionsResponse.parse(suggestions));
});

router.post("/suggestions/generate-list", async (_req, res): Promise<void> => {
  const generatedList = await db.transaction(async (tx) => {
    const inventoryItems = await tx.select().from(inventoryItemsTable);
    const stockSuggestions = getSuggestions(inventoryItems).filter(
      (suggestion) =>
        suggestion.urgency === "critical" || suggestion.urgency === "low"
    );

    if (stockSuggestions.length === 0) {
      return null;
    }

    const [list] = await tx
      .insert(shoppingListsTable)
      .values({ name: "Low-stock shopping list" })
      .returning();

    const listItems = await tx
      .insert(shoppingListItemsTable)
      .values(
        stockSuggestions.map((suggestion) => ({
          shoppingListId: list.id,
          inventoryItemId: suggestion.inventoryItemId,
          name: suggestion.name,
          category: suggestion.category,
          quantity: Math.max(
            suggestion.minThreshold - suggestion.currentQuantity,
            1
          ),
          unit: suggestion.unit,
          notes: suggestion.reason,
        }))
      )
      .returning();

    return {
      ...serializeDates(list),
      items: listItems.map(serializeDates),
    };
  });

  if (!generatedList) {
    res.status(400).json({ error: "No low-stock suggestions are available." });
    return;
  }

  res
    .status(201)
    .json(GenerateShoppingListFromSuggestionsResponse.parse(generatedList));
});

export default router;
