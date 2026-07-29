import { useState } from 'react';
import { Search, Plus, Package, Edit, Trash2, Filter } from 'lucide-react';
import {
  useListInventoryItems,
  useDeleteInventoryItem,
  getListInventoryItemsQueryKey,
  getGetInventoryStatsQueryKey,
  getGetGrocerySuggestionsQueryKey,
} from '@workspace/api-client-react';
import type { InventoryItem } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { InventoryItemDialog } from '@/components/inventory-item-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function Inventory() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [lowStockFilter, setLowStockFilter] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | undefined>();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: items, isLoading } = useListInventoryItems(
    lowStockFilter ? { lowStock: true } : undefined
  );
  const deleteItem = useDeleteInventoryItem();

  const categories = items
    ? Array.from(new Set(items.map((item) => item.category)))
    : [];

  const filteredItems = items?.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory
      ? item.category === selectedCategory
      : true;
    return matchesSearch && matchesCategory;
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
        title: 'Item deleted',
        description: `${itemToDelete.name} has been removed.`,
      });
      queryClient.invalidateQueries({ queryKey: getListInventoryItemsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetInventoryStatsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGrocerySuggestionsQueryKey() });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete item.',
        variant: 'destructive',
      });
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Inventory</h2>
            <p className="text-muted-foreground mt-1">
              Manage your pantry items
            </p>
          </div>
          <Button onClick={handleAdd} data-testid="button-add-item">
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                  data-testid="input-search"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant={lowStockFilter ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setLowStockFilter(!lowStockFilter)}
                  data-testid="filter-low-stock"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Low Stock
                </Button>
                {categories.map((cat) => (
                  <Button
                    key={cat}
                    variant={selectedCategory === cat ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      setSelectedCategory(selectedCategory === cat ? null : cat)
                    }
                    data-testid={`filter-category-${cat.toLowerCase()}`}
                  >
                    {cat}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Items List */}
        <Card>
          <CardHeader>
            <CardTitle>
              {filteredItems?.length || 0} Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : filteredItems && filteredItems.length > 0 ? (
              <div className="space-y-3">
                {filteredItems.map((item, idx) => {
                  const isLowStock = item.quantity <= item.minThreshold;
                  const isOutOfStock = item.quantity === 0;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'p-4 rounded-lg border transition-all hover:shadow-md animate-slide-up',
                        isOutOfStock
                          ? 'border-red-200 bg-red-50/50'
                          : isLowStock
                            ? 'border-amber-200 bg-amber-50/50'
                            : 'border-border bg-card'
                      )}
                      style={{ animationDelay: `${idx * 30}ms` }}
                      data-testid={`inventory-item-${item.id}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h4 className="font-semibold text-lg">
                              {item.name}
                            </h4>
                            <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                              {item.category}
                            </span>
                            {isOutOfStock && (
                              <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 font-medium">
                                Out of Stock
                              </span>
                            )}
                            {isLowStock && !isOutOfStock && (
                              <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 font-medium">
                                Low Stock
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
                            <span className="font-mono font-semibold text-foreground">
                              {item.quantity} {item.unit}
                            </span>
                            <span>Min: {item.minThreshold} {item.unit}</span>
                            {item.expiresAt && (
                              <span>
                                Expires: {new Date(item.expiresAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          {item.notes && (
                            <p className="text-sm text-muted-foreground">
                              {item.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(item)}
                            data-testid={`button-edit-${item.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteClick(item)}
                            data-testid={`button-delete-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No items found.</p>
                <p className="text-sm">Add your first item to get started.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <InventoryItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editingItem}
      />

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
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} data-testid="button-confirm-delete">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
