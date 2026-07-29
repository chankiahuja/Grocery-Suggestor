import { pgTable, text, serial, timestamp, real, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inventoryItemsTable } from "./inventory";

export const shoppingListsTable = pgTable("shopping_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const shoppingListItemsTable = pgTable("shopping_list_items", {
  id: serial("id").primaryKey(),
  shoppingListId: integer("shopping_list_id")
    .notNull()
    .references(() => shoppingListsTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id")
    .references(() => inventoryItemsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  quantity: real("quantity").notNull().default(1),
  unit: text("unit").notNull(),
  purchased: boolean("purchased").notNull().default(false),
  notes: text("notes"),
});

export const insertShoppingListSchema = createInsertSchema(shoppingListsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertShoppingListItemSchema = createInsertSchema(shoppingListItemsTable).omit({
  id: true,
});

export type InsertShoppingList = z.infer<typeof insertShoppingListSchema>;
export type InsertShoppingListItem = z.infer<typeof insertShoppingListItemSchema>;
export type ShoppingList = typeof shoppingListsTable.$inferSelect;
export type ShoppingListItem = typeof shoppingListItemsTable.$inferSelect;
