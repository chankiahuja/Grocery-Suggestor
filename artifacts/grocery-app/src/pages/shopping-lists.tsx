import { useState } from 'react';
import { Plus, ShoppingCart, Trash2, ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import {
  useListShoppingLists,
  useDeleteShoppingList,
  getListShoppingListsQueryKey,
} from '@workspace/api-client-react';
import type { ShoppingList } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { ShoppingListDialog } from '@/components/shopping-list-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

export default function ShoppingLists() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [listToDelete, setListToDelete] = useState<ShoppingList | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: lists, isLoading } = useListShoppingLists();
  const deleteList = useDeleteShoppingList();

  const handleDeleteClick = (list: ShoppingList) => {
    setListToDelete(list);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!listToDelete) return;

    try {
      await deleteList.mutateAsync({ id: listToDelete.id });
      toast({
        title: 'List deleted',
        description: `${listToDelete.name} has been removed.`,
      });
      queryClient.invalidateQueries({ queryKey: getListShoppingListsQueryKey() });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete list.',
        variant: 'destructive',
      });
    } finally {
      setDeleteDialogOpen(false);
      setListToDelete(null);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Shopping Lists</h2>
            <p className="text-muted-foreground mt-1">
              Organize your grocery trips
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)} data-testid="button-create-list">
            <Plus className="h-4 w-4 mr-2" />
            New List
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{lists?.length || 0} Lists</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : lists && lists.length > 0 ? (
              <div className="space-y-3">
                {lists.map((list, idx) => {
                  const progress =
                    list.itemCount > 0
                      ? (list.purchasedCount / list.itemCount) * 100
                      : 0;

                  return (
                    <div
                      key={list.id}
                      className="p-5 rounded-lg border border-border bg-card hover:shadow-md transition-all animate-slide-up group"
                      style={{ animationDelay: `${idx * 40}ms` }}
                      data-testid={`shopping-list-${list.id}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <Link
                          href={`/shopping-lists/${list.id}`}
                          className="flex-1 min-w-0"
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <h4 className="font-semibold text-lg group-hover:text-primary transition-colors">
                              {list.name}
                            </h4>
                            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                          </div>
                          <div className="space-y-2 mb-3">
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="font-mono">
                                {list.purchasedCount} / {list.itemCount} items
                              </span>
                              <span>{Math.round(progress)}% complete</span>
                            </div>
                            <Progress value={progress} className="h-2" />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Created {new Date(list.createdAt).toLocaleDateString()}
                          </p>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            handleDeleteClick(list);
                          }}
                          data-testid={`button-delete-list-${list.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No shopping lists yet.</p>
                <p className="text-sm">Create your first list to get started.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ShoppingListDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-list-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shopping List</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {listToDelete?.name}? This action
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
