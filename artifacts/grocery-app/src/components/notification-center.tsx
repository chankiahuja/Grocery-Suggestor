import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useUtcDate } from "@/hooks/use-utc-date";
import { useSessionAccess } from "@/lib/preview-access";
import {
  Bell,
  AlertCircle,
  AlertTriangle,
  Clock,
  CheckCheck,
  Mail,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePantryEvents } from "@/hooks/use-pantry-events";
import {
  getGetGrocerySuggestionsQueryKey,
  useGetGrocerySuggestions,
} from "@workspace/api-client-react";
import type { GrocerySuggestion } from "@workspace/api-client-react";

const STORAGE_KEY = "pantrypal-seen-notifications";
const EMAIL_REMINDER_NOTE =
  "Expiry reminders by email are planned for a future release. Check your alerts here for now.";

function notifKey(s: GrocerySuggestion) {
  return `${s.inventoryItemId}::${s.urgency}::${s.reason}`;
}

function loadSeen(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(key: string, seen: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...seen])); } catch { /* Reading alerts works without storage. */ }
}

const URGENCY_CONFIG = {
  expired: {
    icon: AlertCircle,
    label: "Expired",
    color: "text-red-800",
    bg: "bg-red-50",
    border: "border-red-200",
    dot: "bg-red-700",
  },
  critical: {
    icon: AlertCircle,
    label: "Out of Stock",
    color: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
    dot: "bg-destructive",
  },
  low: {
    icon: AlertTriangle,
    label: "Low Stock",
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  expiring_soon: {
    icon: Clock,
    label: "Expiring Soon",
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
    dot: "bg-orange-500",
  },
} as const;

export function NotificationCenter() {
  usePantryEvents();
  useUtcDate();
  const { account, demo } = useSessionAccess();
  const storageKey = `${STORAGE_KEY}:${demo ? "demo" : account?.id ?? "anonymous"}`;
  const [open, setOpen] = useState(false);
  const [seenState, setSeen] = useState(() => ({ key: storageKey, values: loadSeen(storageKey) }));
  const seen = seenState.key === storageKey ? seenState.values : loadSeen(storageKey);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { data: suggestions = [], isLoading, isError } = useGetGrocerySuggestions({
    query: {
      queryKey: getGetGrocerySuggestionsQueryKey(),
      refetchInterval: 30_000,
    },
  });

  // Count unread
  const unreadCount = suggestions.filter((s) => !seen.has(notifKey(s))).length;

  // Mark all as read when panel opens
  useEffect(() => {
    if (open && suggestions.length > 0) {
      const next = new Set([...seen, ...suggestions.map(notifKey)]);
      setSeen({ key: storageKey, values: next });
      saveSeen(storageKey, next);
    }
  }, [open, suggestions, storageKey]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  // Group by urgency order
  const criticals = suggestions.filter((s) => s.urgency === "critical");
  const lows = suggestions.filter((s) => s.urgency === "low");
  const expiring = suggestions.filter((s) => s.urgency === "expiring_soon");
  const grouped = [
    { urgency: "expired" as const, items: suggestions.filter((s) => s.urgency === "expired") },
    { urgency: "critical" as const, items: criticals },
    { urgency: "expiring_soon" as const, items: expiring },
    { urgency: "low" as const, items: lows },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "pantry-notification-trigger relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors",
          open
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls={open ? "pantry-notification-panel" : undefined}
        data-testid="notification-bell"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          id="pantry-notification-panel"
          ref={panelRef}
          role="region"
          aria-label="Notifications"
          className="pantry-notification-panel absolute right-0 top-full mt-3 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border"
          data-testid="notification-panel"
        >
          {/* Header */}
          <div className="pantry-notification-panel-header flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-sm text-foreground">
                Notifications
              </span>
              {suggestions.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {suggestions.length} alert
                  {suggestions.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label="Close notifications"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div
            className="pantry-notification-panel-body max-h-96 overflow-y-auto"
          >
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground" role="status">Loading alerts…</p>
            ) : isError ? (
              <p className="p-4 text-sm text-destructive" role="alert">Alerts could not be loaded. Please try again.</p>
            ) : suggestions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
                <CheckCheck className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium text-foreground">
                  All caught up!
                </p>
                <p className="text-xs text-muted-foreground">
                  No low stock or expiry alerts right now.
                </p>
              </div>
            ) : (
              grouped.map(({ urgency, items }) => {
                const cfg = URGENCY_CONFIG[urgency];
                const Icon = cfg.icon;
                return (
                  <div key={urgency}>
                    {/* Group label */}
                    <div className="px-4 py-2 bg-muted/40 border-b border-border">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)}
                        />
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {cfg.label} · {items.length}
                        </span>
                      </div>
                    </div>
                    {/* Items */}
                    {items.map((s) => (
                      <div
                        key={notifKey(s)}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 border-b border-border/60 last:border-b-0",
                          cfg.bg,
                        )}
                      >
                        <Icon
                          className={cn("h-4 w-4 mt-0.5 shrink-0", cfg.color)}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground leading-snug truncate">
                            <Link href={`/inventory?item=${s.inventoryItemId}`} onClick={() => setOpen(false)} className="hover:underline focus-visible:underline">
                            {s.name}
                            </Link>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {s.reason}
                          </p>
                          <span className="inline-block mt-1 text-[10px] font-medium text-muted-foreground bg-background/80 border border-border/60 rounded px-1.5 py-0.5">
                            {s.category}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>

          {/* Informational card; this is not an alert and must not affect counts or unread state. */}
          <div className="border-t border-border px-3 py-3">
            <div
              className="flex items-start gap-2 rounded-lg border border-[#b9cdb0] bg-[#e6ecdc] px-3 py-3 text-[#314634] dark:border-[#526b56] dark:bg-[#28382b] dark:text-[#e7f0e4]"
              data-testid="notification-email-reminder-note"
            >
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#526e49] dark:text-[#b8d2ba]" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold leading-5">
                  Email reminders — coming later
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed">
                  {EMAIL_REMINDER_NOTE}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
