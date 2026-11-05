import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  undoInventoryAdjustment,
  type InventoryItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { refreshPantry } from "@/lib/refresh-pantry";

type Adjustment = { item: InventoryItem; key: string; expiresAt: number };
const FeedbackContext = createContext<(adjustment: Adjustment) => void>(
  () => {},
);
export const useAdjustmentFeedback = () => useContext(FeedbackContext);

/** Kept above routes so navigating to dependent views does not lose Undo. */
export function AdjustmentFeedbackProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const dismissAdjustment = useCallback((key: string) => {
    setAdjustments((current) =>
      current.filter((entry) => entry.key !== key),
    );
  }, []);
  return (
    <FeedbackContext.Provider
      value={(adjustment) =>
        setAdjustments((current) => [...current, adjustment])
      }
    >
      {children}
      {adjustments.length > 0 && (
        <aside
          aria-label="Inventory adjustment feedback"
          className="fixed bottom-4 right-4 z-50 max-h-[50vh] w-[min(24rem,calc(100vw-2rem))] space-y-2 overflow-y-auto"
        >
          {adjustments.map((adjustment) => (
            <AdjustmentFeedback
              key={adjustment.key}
              adjustment={adjustment}
              onDismiss={dismissAdjustment}
            />
          ))}
        </aside>
      )}
    </FeedbackContext.Provider>
  );
}

function AdjustmentFeedback({
  adjustment,
  onDismiss,
}: {
  adjustment: Adjustment;
  onDismiss: (key: string) => void;
}) {
  const { item, key, expiresAt } = adjustment;
  const client = useQueryClient();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [expired, setExpired] = useState(Date.now() >= expiresAt);
  const [terminal, setTerminal] = useState(false);
  const [message, setMessage] = useState(
    `${item.name}: ${item.quantity} ${item.unit} available. Undo is available for up to five minutes.`,
  );
  useEffect(() => {
    const timer = setTimeout(
      () => {
        setExpired(true);
        onDismiss(key);
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, key, onDismiss]);

  async function undo() {
    if (busy.current || terminal) return;
    if (Date.now() >= expiresAt) {
      setExpired(true);
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const result = await undoInventoryAdjustment(item.id, {
        idempotencyKey: key,
      });
      refreshPantry(client, result.inventory);
      setTerminal(true);
      setMessage(
        result.status === "already_undone"
          ? `${item.name}: this adjustment was already undone. Current stock is ${result.inventory.quantity} ${result.inventory.unit}.`
          : `${item.name}: adjustment undone. ${result.inventory.quantity} ${result.inventory.unit} available.`,
      );
    } catch (cause) {
      const failure = cause as { status?: number };
      const status = failure.status;
      const rejected = status !== undefined && status >= 400 && status < 500;
      setTerminal(rejected);
      // A rejected attempt may reflect a change in another tab; an uncertain
      // response may have committed. Reconcile both without guessing quantity.
      refreshPantry(client);
      setMessage(
        status === 410
          ? `${item.name}: the Undo window has expired.`
          : status === 409
            ? `${item.name}: stock changed after this adjustment, so it cannot be undone.`
            : status === 404
              ? `${item.name}: this item or adjustment is no longer available.`
              : rejected
                ? `${item.name}: unable to undo this adjustment.`
                : `${item.name}: we couldn't confirm Undo. Retry Undo safely to check without restoring stock twice.`,
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-lg">
      <p role="status" className="text-sm">
        {expired && !terminal && !pending
          ? `${item.name}: the Undo window has expired.`
          : message}
      </p>
      <div className="mt-2 flex gap-2">
        {!expired && !terminal && (
          <Button size="sm" disabled={pending} onClick={undo}>
            {pending ? "Undoing…" : `Undo ${item.name}`}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => onDismiss(key)}
          aria-label={`Dismiss feedback for ${item.name}`}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
