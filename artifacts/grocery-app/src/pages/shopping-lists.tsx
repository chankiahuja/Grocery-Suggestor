import { useState } from "react";
import { Plus, ShoppingCart, Trash2, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import {
  useListShoppingLists,
  useDeleteShoppingList,
  getListShoppingListsQueryKey,
} from "@workspace/api-client-react";
import type { ShoppingList } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { ShoppingListDialog } from "@/components/shopping-list-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
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

export default function ShoppingLists() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [listsToDelete, setListsToDelete] = useState<ShoppingList[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: lists, isLoading } = useListShoppingLists();
  const deleteList = useDeleteShoppingList();
  const selectedLists = lists?.filter((list) => selectedIds.has(list.id)) ?? [];
  const allSelected = !!lists?.length && selectedLists.length === lists.length;

  const toggleSelection = (id: number, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleDeleteClick = (list: ShoppingList) => {
    setListsToDelete([list]);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!listsToDelete.length || deleting) return;
    setDeleting(true);
    try {
      const results = await Promise.allSettled(
        listsToDelete.map((list) => deleteList.mutateAsync({ id: list.id })),
      );
      const deletedIds = new Set(
        listsToDelete
          .filter((_, index) => results[index].status === "fulfilled")
          .map((list) => list.id),
      );
      const failedCount = listsToDelete.length - deletedIds.size;
      setSelectedIds(
        (previous) =>
          new Set([...previous].filter((id) => !deletedIds.has(id))),
      );
      deletedIds.forEach((id) =>
        queryClient.removeQueries({ queryKey: [`/api/shopping-lists/${id}`] }),
      );
      await queryClient.invalidateQueries({
        queryKey: getListShoppingListsQueryKey(),
      });
      toast({
        title: failedCount
          ? "Some lists could not be deleted"
          : deletedIds.size === 1
            ? "List deleted"
            : "Lists deleted",
        description: `${deletedIds.size} list${deletedIds.size === 1 ? "" : "s"} deleted.${failedCount ? ` ${failedCount} failed. Please try again.` : ""} Pantry inventory is unchanged.`,
        ...(failedCount ? { variant: "destructive" as const } : {}),
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete list.",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setListsToDelete([]);
      setDeleting(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              Shopping Lists
            </h2>
            <p className="text-muted-foreground mt-1">
              Organize your grocery trips
            </p>
          </div>
          <Button
            onClick={() => setDialogOpen(true)}
            data-testid="button-create-list"
          >
            <Plus className="h-4 w-4 mr-2" />
            New List
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{lists?.length || 0} Lists</CardTitle>
            {!!lists?.length && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    aria-label="Select all shopping lists"
                    checked={
                      allSelected
                        ? true
                        : selectedLists.length
                          ? "indeterminate"
                          : false
                    }
                    disabled={deleting}
                    onCheckedChange={(checked) =>
                      setSelectedIds(
                        checked === true
                          ? new Set(lists.map((list) => list.id))
                          : new Set(),
                      )
                    }
                  />
                  Select all
                </label>
                {selectedLists.length > 0 && (
                  <Button
                    variant="destructive"
                    disabled={deleting}
                    onClick={() => {
                      setListsToDelete(selectedLists);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete selected ({selectedLists.length})
                  </Button>
                )}
              </div>
            )}
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
                        <Checkbox
                          className="mt-1.5"
                          aria-label={`Select ${list.name}`}
                          checked={selectedIds.has(list.id)}
                          disabled={deleting}
                          onCheckedChange={(checked) =>
                            toggleSelection(list.id, checked === true)
                          }
                        />
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
                            Created{" "}
                            {new Date(list.createdAt).toLocaleDateString()}
                          </p>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Delete ${list.name}`}
                          disabled={deleting}
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
                <p className="text-sm">
                  Create your first list to get started.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ShoppingListDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!deleting) setDeleteDialogOpen(open);
        }}
      >
        <AlertDialogContent data-testid="dialog-delete-list-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{" "}
              {listsToDelete.length === 1
                ? "Shopping List"
                : `${listsToDelete.length} Shopping Lists`}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {listsToDelete.length === 1
                ? `Delete "${listsToDelete[0].name}" and its entries?`
                : `Delete these ${listsToDelete.length} shopping lists and their entries?`}{" "}
              This cannot be undone. Pantry quantities, including previously
              purchased stock, will stay unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              data-testid="button-cancel-delete"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteConfirm();
              }}
              data-testid="button-confirm-delete"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
