import type { QueryClient } from "@tanstack/react-query";
import {
  getGetInventoryItemQueryKey,
  getListInventoryItemsQueryKey,
  getGetInventoryStatsQueryKey,
  getGetGrocerySuggestionsQueryKey,
  type InventoryItem,
} from "@workspace/api-client-react";

/** Suggestions also supply the notification bell's recoverable alert snapshot. */
export function refreshPantry(client: QueryClient, item?: InventoryItem) {
  if (item) {
    client.setQueryData(getGetInventoryItemQueryKey(item.id), item);
    client.setQueriesData<InventoryItem[]>(
      { queryKey: getListInventoryItemsQueryKey() },
      (items) =>
        items?.map((existing) => (existing.id === item.id ? item : existing)),
    );
  }
  for (const queryKey of [
    getListInventoryItemsQueryKey(),
    getGetInventoryStatsQueryKey(),
    getGetGrocerySuggestionsQueryKey(),
    ...(item ? [getGetInventoryItemQueryKey(item.id)] : []),
  ]) {
    void client.invalidateQueries({ queryKey });
  }
}
