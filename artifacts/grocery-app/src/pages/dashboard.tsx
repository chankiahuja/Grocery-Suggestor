import { Package, AlertCircle, Clock, Layers } from 'lucide-react';
import {
  useGetInventoryStats,
  useGetGrocerySuggestions,
} from '@workspace/api-client-react';
import { Layout } from '@/components/layout';
import { StatCard } from '@/components/stat-card';
import { UrgencyBadge } from '@/components/urgency-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetInventoryStats();
  const { data: suggestions, isLoading: suggestionsLoading } = useGetGrocerySuggestions();

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

        {/* Category Breakdown */}
        {!statsLoading && stats && stats.categoryBreakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Category Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {stats.categoryBreakdown.map((cat) => (
                  <div
                    key={cat.category}
                    className="p-4 rounded-lg bg-muted/50 border border-border"
                    data-testid={`category-${cat.category.toLowerCase()}`}
                  >
                    <div className="text-sm font-medium text-muted-foreground">
                      {cat.category}
                    </div>
                    <div className="text-2xl font-bold font-mono mt-1">
                      {cat.count}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

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
