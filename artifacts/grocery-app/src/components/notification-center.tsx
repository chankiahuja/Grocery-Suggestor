import { useState, useEffect, useRef } from 'react';
import { Bell, AlertCircle, AlertTriangle, Clock, CheckCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGetGrocerySuggestions } from '@workspace/api-client-react';
import type { GrocerySuggestion } from '@workspace/api-client-react';

const STORAGE_KEY = 'pantrypal-seen-notifications';

function notifKey(s: GrocerySuggestion) {
  return `${s.name}::${s.urgency}`;
}

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
}

const URGENCY_CONFIG = {
  critical: {
    icon: AlertCircle,
    label: 'Out of Stock',
    color: 'text-destructive',
    bg: 'bg-destructive/10',
    border: 'border-destructive/20',
    dot: 'bg-destructive',
  },
  low: {
    icon: AlertTriangle,
    label: 'Low Stock',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  expiring_soon: {
    icon: Clock,
    label: 'Expiring Soon',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    dot: 'bg-orange-500',
  },
} as const;

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(loadSeen);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { data: suggestions = [] } = useGetGrocerySuggestions({
    query: { refetchInterval: 30_000 },
  });

  // Count unread
  const unreadCount = suggestions.filter((s) => !seen.has(notifKey(s))).length;

  // Mark all as read when panel opens
  useEffect(() => {
    if (open && suggestions.length > 0) {
      const next = new Set([...seen, ...suggestions.map(notifKey)]);
      setSeen(next);
      saveSeen(next);
    }
  }, [open]);

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
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Group by urgency order
  const criticals = suggestions.filter((s) => s.urgency === 'critical');
  const lows = suggestions.filter((s) => s.urgency === 'low');
  const expiring = suggestions.filter((s) => s.urgency === 'expiring_soon');
  const grouped = [
    { urgency: 'critical' as const, items: criticals },
    { urgency: 'low' as const, items: lows },
    { urgency: 'expiring_soon' as const, items: expiring },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors',
          open
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        )}
        aria-label="Notifications"
        data-testid="notification-bell"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute left-full top-0 ml-2 z-50 w-80 rounded-xl border border-border bg-card shadow-xl"
          data-testid="notification-panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-sm text-foreground">Notifications</span>
              {suggestions.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {suggestions.length} alert{suggestions.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="max-h-96 overflow-y-auto">
            {suggestions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
                <CheckCheck className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium text-foreground">All caught up!</p>
                <p className="text-xs text-muted-foreground">No low stock or expiry alerts right now.</p>
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
                        <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
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
                          'flex items-start gap-3 px-4 py-3 border-b border-border/60 last:border-b-0',
                          cfg.bg
                        )}
                      >
                        <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', cfg.color)} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground leading-snug truncate">
                            {s.name}
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
        </div>
      )}
    </div>
  );
}
