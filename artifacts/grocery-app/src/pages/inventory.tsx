import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Search,
  Plus,
  Package,
  Edit,
  Trash2,
  Filter,
  Clock,
  CircleX,
  RefreshCw,
} from "lucide-react";
import {
  useListInventoryItems,
  useDeleteInventoryItem,
  getListInventoryItemsQueryKey,
  getGetInventoryStatsQueryKey,
  getGetGrocerySuggestionsQueryKey,
} from "@workspace/api-client-react";
import type { InventoryItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { InventoryItemDialog } from "@/components/inventory-item-dialog";
import { InventoryAdjustmentDialog } from "@/components/inventory-adjustment-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isExpiringSoon } from "@/lib/category-attention";

export default function Inventory() {
  const searchParams = useSearch();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const filters = new URLSearchParams(searchParams);
  const selectedCategory = filters.get("category");
  const selectedStock = filters.get("stock");
  const stockFilter = selectedStock === "low" || selectedStock === "out" || selectedStock === "expiring"
    ? selectedStock : null;
  const updateFilter = (key: "category" | "stock", value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    setLocation(`/inventory${query ? `?${query}` : ""}`);
  };
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | undefined>();
  const [adjustment, setAdjustment] = useState<{
    item: InventoryItem;
    operation: "consume" | "restock";
  } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isItemExpired = (expiresAt?: string | null) => {
    if (!expiresAt) return false;

    const [year, month, day] = expiresAt.slice(0, 10).split("-").map(Number);
    const expirationDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return expirationDate < today;
  };

  const { data: items, isLoading, isError, isFetching, refetch } = useListInventoryItems(
    stockFilter === "low" ? { lowStock: true } : stockFilter === "out" ? { outOfStock: true } : undefined,
  );
  const { data: allItems } = useListInventoryItems();
  const deleteItem = useDeleteInventoryItem();

  const categories = allItems
    ? Array.from(new Set(allItems.map((item) => item.category)))
    : [];

  const filteredItems = items?.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory
      ? item.category === selectedCategory
      : true;
    const matchesExpiration =
      stockFilter !== "expiring" || isExpiringSoon(item.expiresAt);
    return matchesSearch && matchesCategory && matchesExpiration;
  });

  const handleEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingItem(undefined);
    setDialogOpen(true);
  };

  const handleDeleteClick = (item: InventoryItem) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;

    try {
      await deleteItem.mutateAsync({ id: itemToDelete.id });
      toast({
        title: "Item deleted",
        description: `${itemToDelete.name} has been removed.`,
      });
      queryClient.invalidateQueries({
        queryKey: getListInventoryItemsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getGetInventoryStatsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getGetGrocerySuggestionsQueryKey(),
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete item.",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  return (
    <Layout>
      <div className="inventory-page flex flex-col gap-6">
        <div className="inventory-heading flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Inventory</h2>
            <p className="text-muted-foreground mt-1">
              Manage the essentials your household uses.
            </p>
          </div>
          <Button className="inventory-add-button" onClick={handleAdd} data-testid="button-add-item">
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </div>

        {/* Filters */}
        <Card className="inventory-filter-panel">
          <CardContent className="inventory-filter-content p-4">
            <div className="inventory-filter-layout flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="inventory-search-icon absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="inventory-search-input pl-10"
                  data-testid="input-search"
                />
              </div>
              <div className="inventory-filter-chips flex gap-2 flex-wrap" aria-label="Inventory filters">
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("inventory-filter-chip inventory-filter-chip-low", stockFilter === "low" && "is-selected")}
                  onClick={() => updateFilter("stock", stockFilter === "low" ? null : "low")}
                  data-testid="filter-low-stock"
                  aria-pressed={stockFilter === "low"}
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Low Stock
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("inventory-filter-chip inventory-filter-chip-out", stockFilter === "out" && "is-selected")}
                  onClick={() => updateFilter("stock", stockFilter === "out" ? null : "out")}
                  data-testid="filter-out-of-stock"
                  aria-pressed={stockFilter === "out"}
                >
                  <CircleX className="h-4 w-4 mr-2" />
                  Out of Stock
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("inventory-filter-chip inventory-filter-chip-expiring", stockFilter === "expiring" && "is-selected")}
                  onClick={() => updateFilter("stock", stockFilter === "expiring" ? null : "expiring")}
                  data-testid="filter-expiring-soon"
                  aria-pressed={stockFilter === "expiring"}
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Expiring Soon
                </Button>
                {categories.map((cat) => (
                  <Button
                    key={cat}
                    variant="outline"
                    size="sm"
                    className={cn("inventory-filter-chip inventory-filter-chip-category", selectedCategory === cat && "is-selected")}
                    onClick={() => updateFilter("category", selectedCategory === cat ? null : cat)}
                    data-testid={`filter-category-${cat.toLowerCase()}`}
                    aria-pressed={selectedCategory === cat}
                  >
                    {cat}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Items List */}
        <Card className="inventory-results-panel">
          <CardHeader className="inventory-results-header">
            <CardTitle className="inventory-results-title">
              {isLoading || isError
                ? "Inventory"
                : `${filteredItems?.length || 0} Items`}
            </CardTitle>
            {!isLoading && !isError && (
              <p className="inventory-results-description">
                {search || selectedCategory || stockFilter
                  ? "Matching household essentials"
                  : "Everything you keep track of, all in one place."}
              </p>
            )}
          </CardHeader>
          <CardContent className="inventory-results-content">
            {isLoading ? (
              <div className="inventory-loading-grid">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="inventory-loading-card" />
                ))}
              </div>
            ) : isError && !items ? (
              <div className="inventory-state inventory-error" role="alert">
                <CircleX className="inventory-state-icon" />
                <div>
                  <p className="inventory-state-title">Inventory could not be loaded.</p>
                  <p className="inventory-state-description">
                    Check your connection and try again.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                  Try again
                </Button>
              </div>
            ) : (
              <>
                {isError && items && items.length > 0 && (
                  <div className="inventory-warning" role="status">
                    <RefreshCw className="inventory-state-icon" />
                    <div>
                      <p className="inventory-state-title">Showing cached inventory.</p>
                      <p className="inventory-state-description">
                        A refresh failed, so the latest saved items are still visible.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void refetch()}
                      disabled={isFetching}
                    >
                      Refresh
                    </Button>
                  </div>
                )}
                {filteredItems && filteredItems.length > 0 ? (
                  <div className="pantry-inventory-grid inventory-card-grid">
                    {filteredItems.map((item, idx) => {
                      const isLowStock = item.quantity <= item.minThreshold;
                      const isOutOfStock = item.quantity === 0;
                      const isExpired = isItemExpired(item.expiresAt);
                      const expiringSoon = isExpiringSoon(item.expiresAt);

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "inventory-item-card animate-slide-up",
                            isOutOfStock
                              ? "inventory-item-out"
                              : isLowStock
                                ? "inventory-item-low"
                                : isExpired || expiringSoon
                                  ? "inventory-item-expiring"
                                  : "inventory-item-healthy",
                          )}
                          style={{ animationDelay: `${idx * 30}ms` }}
                          data-testid={`inventory-item-${item.id}`}
                        >
                          <div className="inventory-item-header">
                            <div className="inventory-item-heading">
                              <h4 className="inventory-item-name">{item.name}</h4>
                              <div className="inventory-item-badges">
                                <span className="inventory-category-badge">
                                  {item.category}
                                </span>
                                {isOutOfStock && (
                                  <span className="inventory-status-badge inventory-status-out">
                                    Out of Stock
                                  </span>
                                )}
                                {isLowStock && !isOutOfStock && (
                                  <span className="inventory-status-badge inventory-status-low">
                                    Low Stock
                                  </span>
                                )}
                                {isExpired && !isLowStock && !isOutOfStock && (
                                  <span className="inventory-status-badge inventory-status-expiring">
                                    Expired
                                  </span>
                                )}
                                {expiringSoon && !isExpired && !isLowStock && !isOutOfStock && (
                                  <span className="inventory-status-badge inventory-status-expiring">
                                    Expiring Soon
                                  </span>
                                )}
                                {!isOutOfStock && !isLowStock && !isExpired && !expiringSoon && (
                                  <span className="inventory-status-badge inventory-status-healthy">
                                    In good shape
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="inventory-item-actions">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleEdit(item)}
                                aria-label={`Edit ${item.name}`}
                                data-testid={`button-edit-${item.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteClick(item)}
                                aria-label={`Delete ${item.name}`}
                                data-testid={`button-delete-${item.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="inventory-item-details">
                            <div className="inventory-quantity">
                              <span className="inventory-quantity-label">On hand</span>
                              <span className="inventory-quantity-value">
                                {item.quantity} <span>{item.unit}</span>
                              </span>
                            </div>
                            <div className="inventory-item-meta">
                              <span>
                                Minimum: {item.minThreshold} {item.unit}
                              </span>
                              {item.expiresAt && (
                                <span>
                                  <Clock aria-hidden="true" />
                                  Expires:{" "}
                                  {new Date(item.expiresAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                          {item.notes && (
                            <p className="inventory-item-notes">{item.notes}</p>
                          )}
                          <div className="inventory-adjustment-actions">
                            <Button
                              variant="outline"
                              size="sm"
                              className="inventory-adjustment-button"
                              disabled={item.quantity === 0}
                              aria-label={`Consume ${item.name}`}
                              data-testid={`button-consume-${item.id}`}
                              onClick={() =>
                                setAdjustment({ item, operation: "consume" })
                              }
                            >
                              Consume
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="inventory-adjustment-button"
                              aria-label={`Restock ${item.name}`}
                              data-testid={`button-restock-${item.id}`}
                              onClick={() =>
                                setAdjustment({ item, operation: "restock" })
                              }
                            >
                              Restock
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="inventory-state inventory-empty">
                    <Package className="inventory-state-icon" />
                    <p className="inventory-state-title">
                      {search || selectedCategory || stockFilter
                        ? "No items match these filters."
                        : "No inventory items yet."}
                    </p>
                    <p className="inventory-state-description">
                      {search || selectedCategory || stockFilter
                        ? "Try a different search or filter."
                        : "Add your household essentials to get started."}
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <InventoryItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editingItem}
      />
      {adjustment && (
        <InventoryAdjustmentDialog
          item={
            items?.find((item) => item.id === adjustment.item.id) ??
            adjustment.item
          }
          operation={adjustment.operation}
          onClose={() => setAdjustment(null)}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {itemToDelete?.name}? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
