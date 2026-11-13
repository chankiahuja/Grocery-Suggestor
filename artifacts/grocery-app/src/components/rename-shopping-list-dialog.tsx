import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetShoppingListQueryKey,
  getListShoppingListsQueryKey,
  useUpdateShoppingList,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  shoppingListNameError,
  trimShoppingListBoundaryWhitespace,
} from "@/lib/shopping-list-name";

interface RenameShoppingListDialogProps {
  listId: number;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameShoppingListDialog({
  listId,
  currentName,
  open,
  onOpenChange,
}: RenameShoppingListDialogProps) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string>();
  const updateList = useUpdateShoppingList();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(currentName);
      setError(undefined);
    }
    wasOpen.current = open;
  }, [currentName, open]);

  const handleSave = async () => {
    const validationError = shoppingListNameError(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    const normalizedName = trimShoppingListBoundaryWhitespace(name);
    setError(undefined);
    try {
      const updatedList = await updateList.mutateAsync({ id: listId, data: { name: normalizedName } });
      const detailQueryKey = getGetShoppingListQueryKey(listId);
      await queryClient.cancelQueries({ queryKey: detailQueryKey });
      queryClient.setQueryData(detailQueryKey, updatedList);
      await queryClient.invalidateQueries({ queryKey: getListShoppingListsQueryKey() });
      toast({
        title: "Shopping list renamed",
        description: `The list is now named ${normalizedName}.`,
      });
      onOpenChange(false);
    } catch {
      setError("Could not rename the shopping list. Please try again.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!updateList.isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent data-testid="dialog-rename-list">
        <DialogHeader>
          <DialogTitle>Edit shopping list name</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="shopping-list-name" className="text-sm font-medium">
              List name
            </label>
            <Input
              id="shopping-list-name"
              autoFocus
              value={name}
              disabled={updateList.isPending}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "shopping-list-name-error" : undefined}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(undefined);
              }}
            />
            {error && (
              <p id="shopping-list-name-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={updateList.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateList.isPending}>
              {updateList.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
