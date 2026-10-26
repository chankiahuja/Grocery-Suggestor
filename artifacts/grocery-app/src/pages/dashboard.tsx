import { useMemo } from 'react';
import { Link } from 'wouter';
import {
  Package,
  AlertCircle,
  Clock,
  Layers,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import {
  useGetInventoryStats,
  useGetGrocerySuggestions,
  useListInventoryItems,
} from '@workspace/api-client-react';
import { Layout } from '@/components/layout';
import { StatCard } from '@/components/stat-card';
import { UrgencyBadge } from '@/components/urgency-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getCategoryAttention } from '@/lib/category-attention';

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetInventoryStats();
  const { data: suggestions, isLoading: suggestionsLoading } = useGetGrocerySuggestions();
  const {
    data: inventoryItems,
    isLoading: inventoryLoading,
    isError: inventoryError,
    isFetching: inventoryFetching,
    refetch: refetchInventory,
  } = useListInventoryItems();

  const categoryAttention = useMemo(
    () => getCategoryAttention(inventoryItems ?? []),
    [inventoryItems]
  );

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground mt-1">
            Your pantry at a glance
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statsLoading ? (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <>
              <StatCard
                label="Total Items"
                value={stats?.totalItems || 0}
                icon={Package}
                testId="stat-total-items"
              />
              <StatCard
                label="Low Stock"
                value={stats?.lowStockCount || 0}
                icon={AlertCircle}
                testId="stat-low-stock"
              />
              <StatCard
                label="Out of Stock"
                value={stats?.outOfStockCount || 0}
                icon={AlertCircle}
                testId="stat-out-of-stock"
              />
              <StatCard
                label="Expiring Soon"
                value={stats?.expiringCount || 0}
                icon={Clock}
                testId="stat-expiring"
              />
            </>
          )}
        </div>

        {/* Pantry Attention by Category */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Pantry Attention by Category
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Stock and freshness issues, ordered by urgency
            </p>
          </CardHeader>
          <CardContent>
            {inventoryLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : inventoryError ? (
              <div
                className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground"
                role="alert"
              >
                <AlertCircle className="h-10 w-10 opacity-60" />
                <div>
                  <p className="font-medium text-foreground">
                    Pantry attention could not be loaded.
                  </p>
                  <p className="text-sm">Check your connection and try again.</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetchInventory()}
                  disabled={inventoryFetching}
                >
                  <RefreshCw
                    className={cn('h-4 w-4', inventoryFetching && 'animate-spin')}
                  />
                  Try again
                </Button>
              </div>
            ) : categoryAttention.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {categoryAttention.map((category) => {
                  const metrics = [
                    {
                      label: 'Out',
                      count: category.outOfStock,
                      tone: 'urgency-critical',
                    },
                    {
                      label: 'Low',
                      count: category.lowStock,
                      tone: 'urgency-low',
                    },
                    {
                      label: 'Expiring',
                      count: category.expiringSoon,
                      tone: 'urgency-expiring',
                    },
                  ];

                  return (
                    <Link
                      key={category.category}
                      href={`/inventory?category=${encodeURIComponent(category.category)}`}
                      aria-label={`View ${category.category}: ${category.attentionItems} items need attention`}
                      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={`category-attention-${category.category
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold">
                            {category.category}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            <span className="font-mono font-semibold text-foreground">
                              {category.attentionItems}
                            </span>{' '}
                            {category.attentionItems === 1
                              ? 'item needs'
                              : 'items need'}{' '}
                            attention
                          </p>
                        </div>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {metrics.map((metric) => (
                          <span
                            key={metric.label}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
                              metric.tone,
                              metric.count === 0 && 'opacity-60'
                            )}
                          >
                            <span className="font-mono font-bold">
                              {metric.count}
                            </span>
                            {metric.label}
                          </span>
                        ))}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-primary/70" />
                <p className="font-medium text-foreground">
                  Your pantry is in good shape.
                </p>
                <p className="text-sm">
                  No low-stock, out-of-stock, or soon-to-expire items.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grocery Suggestions */}
        <Card>
          <CardHeader>
            <CardTitle>Grocery Suggestions</CardTitle>
          </CardHeader>
          <CardContent>
            {suggestionsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : suggestions && suggestions.length > 0 ? (
              <div className="space-y-3">
                {suggestions.map((suggestion, idx) => (
                  <div
                    key={`${suggestion.name}-${idx}`}
                    className="p-4 rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors animate-slide-up"
                    style={{ animationDelay: `${idx * 50}ms` }}
                    data-testid={`suggestion-${idx}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-semibold text-lg">{suggestion.name}</h4>
                          <UrgencyBadge urgency={suggestion.urgency} />
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {suggestion.reason}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="font-mono">
                            Current: {suggestion.currentQuantity} {suggestion.unit}
                          </span>
                          <span className="font-mono">
                            Min: {suggestion.minThreshold} {suggestion.unit}
                          </span>
                          <span className="px-2 py-1 rounded bg-muted">
                            {suggestion.category}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No grocery suggestions right now.</p>
                <p className="text-sm">Your pantry is well stocked!</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
