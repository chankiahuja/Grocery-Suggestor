import { cn } from '@/lib/utils';
import { AlertCircle, AlertTriangle, Clock } from 'lucide-react';

interface UrgencyBadgeProps {
  urgency: 'critical' | 'low' | 'expiring_soon';
  className?: string;
}

export function UrgencyBadge({ urgency, className }: UrgencyBadgeProps) {
  const config = {
    critical: {
      label: 'Out of Stock',
      icon: AlertCircle,
      className: 'urgency-critical',
    },
    low: {
      label: 'Low Stock',
      icon: AlertTriangle,
      className: 'urgency-low',
    },
    expiring_soon: {
      label: 'Expiring Soon',
      icon: Clock,
      className: 'urgency-expiring',
    },
  };

  const { label, icon: Icon, className: urgencyClass } = config[urgency];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border',
        urgencyClass,
        className
      )}
      data-testid={`badge-urgency-${urgency}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
