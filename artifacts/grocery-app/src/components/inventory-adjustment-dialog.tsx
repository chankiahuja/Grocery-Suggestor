import { useRef, useState } from "react";
import {
  adjustInventoryItem,
  getGetInventoryItemQueryKey,
  getListInventoryItemsQueryKey,
  type InventoryItem,
  type InventoryAdjustmentInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export function InventoryAdjustmentDialog({
  item,
  operation,
  onClose,
}: {
  item: InventoryItem;
  operation: InventoryAdjustmentInput["operation"];
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const attempt = useRef<{ key: string; amount: number } | null>(null);
  const [retryRequired, setRetryRequired] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const title = operation === "consume" ? "Consume" : "Restock";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const value = Number(amount);
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    // On an uncertain response, retry the exact request, even if a refetch changed stock.
    if (!retryRequired && operation === "consume" && value > item.quantity) {
      setError(`Only ${item.quantity} ${item.unit} available.`);
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (!attempt.current || attempt.current.amount !== value) {
        attempt.current = { key: crypto.randomUUID(), amount: value };
      }
      const updated = await adjustInventoryItem(
        item.id,
        { operation, amount: value },
        {
          headers: { "Idempotency-Key": attempt.current.key },
        },
      );
      queryClient.setQueryData(getGetInventoryItemQueryKey(item.id), updated);
      queryClient.setQueriesData<InventoryItem[]>(
        { queryKey: getListInventoryItemsQueryKey() },
        (items) =>
          items?.map((existing) =>
            existing.id === updated.id ? updated : existing,
          ),
      );
      // Reconcile filtered lists (e.g. an item restocked above its threshold).
      void queryClient.invalidateQueries({
        queryKey: getListInventoryItemsQueryKey(),
      });
      toast({
        title: operation === "consume" ? "Stock consumed" : "Stock restocked",
        description: `${updated.name}: ${updated.quantity} ${updated.unit} available.`,
      });
      onClose();
    } catch (cause) {
      const failure = cause as { status?: number; data?: { error?: string } };
      const uncertain =
        !failure.status ||
        failure.status >= 500 ||
        (failure.status >= 200 && failure.status < 300);
      setRetryRequired(uncertain);
      if (!uncertain) attempt.current = null;
      setError(
        uncertain
          ? "We couldn't confirm the change. Retry this action to check it safely without applying it twice."
          : failure.data?.error || "Unable to update stock. Please try again.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy.current && !retryRequired) onClose();
      }}
    >
      <DialogContent
        data-testid="dialog-adjust-inventory"
        onEscapeKeyDown={(event) => {
          if (pending || retryRequired) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending || retryRequired) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {title} {item.name}
          </DialogTitle>
          <DialogDescription>
            Available: {item.quantity} {item.unit}. Enter the amount to{" "}
            {operation}.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={submit}
          noValidate
          className="space-y-4"
          aria-busy={pending}
        >
          <div className="space-y-2">
            <Label htmlFor="adjustment-amount">Amount ({item.unit})</Label>
            <Input
              id="adjustment-amount"
              autoFocus
              type="number"
              step="any"
              min="0"
              value={amount}
              disabled={pending || retryRequired}
              aria-invalid={!!error}
              aria-describedby={error ? "adjustment-error" : undefined}
              onChange={(event) => {
                setAmount(event.target.value);
                setError("");
              }}
            />
          </div>
          {error && (
            <p
              id="adjustment-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              {retryRequired ? "Close without retrying" : "Cancel"}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              )}
              {pending ? "Updating…" : retryRequired ? "Retry safely" : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
