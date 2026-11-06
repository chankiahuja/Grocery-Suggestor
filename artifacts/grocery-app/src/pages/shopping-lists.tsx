import { useState } from "react";
import {
  Plus,
  ShoppingCart,
  Trash2,
  ChevronRight,
  Tags,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
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

  const {
    data: lists,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useListShoppingLists();
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
    let deletedIds = new Set<number>();
    let failedIds = listsToDelete.map((list) => list.id);
    try {
      const results = await Promise.allSettled(
        listsToDelete.map((list) => deleteList.mutateAsync({ id: list.id })),
      );
      deletedIds = new Set(
        listsToDelete
          .filter((_, index) => results[index].status === "fulfilled")
          .map((list) => list.id),
      );
      const failedCount = listsToDelete.length - deletedIds.size;
      failedIds = listsToDelete
        .filter((_, index) => results[index].status === "rejected")
        .map((list) => list.id);
      setSelectedIds(
        (previous) =>
          new Set(
            [...previous, ...failedIds].filter((id) => !deletedIds.has(id)),
          ),
      );
      deletedIds.forEach((id) =>
        queryClient.removeQueries({ queryKey: [`/api/shopping-lists/${id}`] }),
      );
      await queryClient.invalidateQueries(
        { queryKey: getListShoppingListsQueryKey() },
        { throwOnError: true },
      );
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
      setSelectedIds(
        (previous) =>
          new Set(
            [...previous, ...failedIds].filter((id) => !deletedIds.has(id)),
          ),
      );
      toast({
        title: deletedIds.size ? "Could not refresh shopping lists" : "Error",
        description: deletedIds.size
          ? "Some lists were deleted, but the list view could not refresh. Please try again."
          : "Failed to delete list.",
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
      <div className="space-y-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <span className="pantry-eyebrow">Your shopping, in one place</span>
            <h2 className="mt-2 text-3xl font-normal tracking-tight">
              Shopping Lists
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Plan the essentials and keep each trip moving.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/compare-prices">
              <Button
                variant="outline"
                aria-label="Compare prices (sample)"
                data-testid="button-compare-prices"
              >
                <Tags className="mr-2 h-4 w-4" />
                Compare prices{" "}
                <span className="ml-1 text-xs opacity-70">(sample)</span>
              </Button>
            </Link>
            <Button
              onClick={() => setDialogOpen(true)}
              data-testid="button-create-list"
            >
              <Plus className="mr-2 h-4 w-4" />
              New List
            </Button>
          </div>
        </div>

        <section
          aria-label="Your shopping lists"
          className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7"
        >
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
            <div>
              <p className="pantry-eyebrow">Ready when you are</p>
              <h3 className="mt-1 text-xl font-medium">
                Your lists{" "}
                <span className="text-muted-foreground">
                  ({lists?.length ?? 0})
                </span>
              </h3>
            </div>
            {!!lists?.length && !isError && (
              <div className="flex flex-wrap items-center gap-3 sm:gap-5">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
                    size="sm"
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
          </div>
          {isLoading ? (
            <div
              className="grid gap-4 md:grid-cols-2"
              role="status"
              aria-label="Loading shopping lists"
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full rounded-xl" />
              ))}
            </div>
          ) : isError ? (
            <div
              className="flex flex-col items-center rounded-xl border border-border bg-background px-6 py-12 text-center"
              role="alert"
            >
              <AlertCircle className="mb-4 h-8 w-8 text-destructive" />
              <h4 className="text-lg font-medium">Could not load your lists</h4>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Check your connection and try again. Your lists have not been
                changed.
              </p>
              <Button
                className="mt-5"
                variant="outline"
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {isFetching ? "Retrying..." : "Try again"}
              </Button>
            </div>
          ) : lists && lists.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {lists.map((list, idx) => {
                const progress =
                  list.itemCount > 0
                    ? (list.purchasedCount / list.itemCount) * 100
                    : 0;

                return (
                  <article
                    key={list.id}
                    className="group rounded-xl border border-border bg-background p-5 transition-shadow hover:shadow-md animate-slide-up"
                    style={{ animationDelay: `${idx * 40}ms` }}
                    data-testid={`shopping-list-${list.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        className="mt-1"
                        aria-label={`Select ${list.name}`}
                        checked={selectedIds.has(list.id)}
                        disabled={deleting}
                        onCheckedChange={(checked) =>
                          toggleSelection(list.id, checked === true)
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          Created{" "}
                          {new Date(list.createdAt).toLocaleDateString()}
                        </p>
                        <Link
                          href={`/shopping-lists/${list.id}`}
                          className="mt-1 inline-flex max-w-full items-center gap-1 rounded-sm text-lg font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          <span className="truncate">{list.name}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
                        </Link>
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
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
                    <div className="mt-6 flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">
                        {list.purchasedCount} of {list.itemCount} items
                        purchased
                      </span>
                      <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                        {list.itemCount === 0
                          ? "No items yet"
                          : progress === 100
                            ? "Complete"
                            : progress > 0
                              ? "In progress"
                              : "Ready to shop"}
                      </span>
                    </div>
                    <Progress
                      value={progress}
                      className="mt-3 h-2"
                      aria-label={`${list.name}: ${Math.round(progress)}% complete`}
                    />
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-background px-6 py-14 text-center">
              <ShoppingCart className="mx-auto mb-4 h-10 w-10 text-primary/60" />
              <h4 className="text-lg font-medium">No shopping lists yet.</h4>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Create a list to gather everything for your next trip.
              </p>
              <Button className="mt-6" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New List
              </Button>
            </div>
          )}
        </section>
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
