import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  trend?: string;
  testId?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  testId,
}: StatCardProps) {
  return (
    <Card className="pantry-stat overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p
              className="pantry-stat-value tracking-tight"
              data-testid={testId}
            >
              {value}
            </p>
            {trend && <p className="text-xs text-muted-foreground">{trend}</p>}
          </div>
          <div className="hidden sm:block p-2.5 bg-primary/10 rounded-full">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
