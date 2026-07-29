import { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Plus, ShoppingBag, ArrowLeft, Trash2 } from 'lucide-react';
import {
  useGetShoppingList,
  useUpdateShoppingListItem,
  useDeleteShoppingListItem,
  usePurchaseShoppingList,
  getGetShoppingListQueryKey,
  getListShoppingListsQueryKey,
  getListInventoryItemsQueryKey,
  getGetInventoryStatsQueryKey,
} from '@workspace/api-client-react';
import type { ShoppingListItem } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { AddShoppingItemDialog } from '@/components/add-shopping-item-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
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

export default function ShoppingListDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const listId = Number(params.id);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ShoppingListItem | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: list, isLoading } = useGetShoppingList(listId, {
    query: {
      enabled: !!listId,
      queryKey: getGetShoppingListQueryKey(listId),
    },
  });

  const updateItem = useUpdateShoppingListItem();
  const deleteItem = useDeleteShoppingListItem();
  const purchaseList = usePurchaseShoppingList();

  const handleTogglePurchased = async (item: ShoppingListItem) => {
    try {
      await updateItem.mutateAsync({
        id: listId,
        itemId: item.id,
        data: { purchased: !item.purchased },
      });

      queryClient.invalidateQueries({
        queryKey: getGetShoppingListQueryKey(listId),
      });
      queryClient.invalidateQueries({
        queryKey: getListShoppingListsQueryKey(),
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update item.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteClick = (item: ShoppingListItem) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;

    try {
      await deleteItem.mutateAsync({
        id: listId,
        itemId: itemToDelete.id,
      });
      toast({
        title: 'Item removed',
        description: `${itemToDelete.name} has been removed from the list.`,
      });
      queryClient.invalidateQueries({
        queryKey: getGetShoppingListQueryKey(listId),
      });
      queryClient.invalidateQueries({
        queryKey: getListShoppingListsQueryKey(),
      });
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

  const handlePurchase = async () => {
    try {
      const result = await purchaseList.mutateAsync({ id: listId });
      toast({
        title: 'Purchase complete',
        description: `Restocked ${result.updatedInventoryItems} items in inventory.`,
      });
      queryClient.invalidateQueries({
        queryKey: getGetShoppingListQueryKey(listId),
      });
      queryClient.invalidateQueries({
        queryKey: getListShoppingListsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getListInventoryItemsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: getGetInventoryStatsQueryKey(),
      });
      setLocation('/shopping-lists');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to complete purchase.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </Layout>
    );
  }

  if (!list) {
    return (
      <Layout>
        <div className="text-center py-12 text-muted-foreground">
          <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Shopping list not found.</p>
        </div>
      </Layout>
    );
  }

  const progress =
    list.items.length > 0
      ? (list.items.filter((i) => i.purchased).length / list.items.length) * 100
      : 0;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation('/shopping-lists')}
            className="mb-4"
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Lists
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">{list.name}</h2>
              <p className="text-muted-foreground mt-1">
                {list.items.filter((i) => i.purchased).length} / {list.items.length} items purchased
              </p>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-item">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
              {list.items.length > 0 && (
                <Button
                  onClick={handlePurchase}
                  disabled={purchaseList.isPending}
                  data-testid="button-complete-purchase"
                >
                  <ShoppingBag className="h-4 w-4 mr-2" />
                  {purchaseList.isPending ? 'Processing...' : 'Complete Purchase'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {list.items.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Progress</span>
                  <span className="font-mono">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-3" />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent>
            {list.items.length > 0 ? (
              <div className="space-y-3">
                {list.items.map((item, idx) => (
                  <div
                    key={item.id}
                    className={cn(
                      'p-4 rounded-lg border transition-all hover:shadow-sm animate-slide-up',
                      item.purchased
                        ? 'bg-muted/50 border-border opacity-75'
                        : 'bg-card border-border'
                    )}
                    style={{ animationDelay: `${idx * 30}ms` }}
                    data-testid={`shopping-item-${item.id}`}
                  >
                    <div className="flex items-start gap-4">
                      <Checkbox
                        checked={item.purchased}
                        onCheckedChange={() => handleTogglePurchased(item)}
                        className="mt-1 animate-check-pulse"
                        data-testid={`checkbox-purchased-${item.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h4
                            className={cn(
                              'font-semibold text-lg',
                              item.purchased && 'line-through text-muted-foreground'
                            )}
                          >
                            {item.name}
                          </h4>
                          <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                            {item.category}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="font-mono">
                            {item.quantity} {item.unit}
                          </span>
                        </div>
                        {item.notes && (
                          <p className="text-sm text-muted-foreground mt-2">
                            {item.notes}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteClick(item)}
                        data-testid={`button-delete-item-${item.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No items in this list yet.</p>
                <p className="text-sm">Add items to start shopping.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AddShoppingItemDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        shoppingListId={listId}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-item-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {itemToDelete?.name} from this list?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} data-testid="button-confirm-delete">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
