import { Link, useLocation } from 'wouter';
import { Home, Package, ShoppingCart, Bell, BellOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/hooks/use-notifications';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { permission, requestPermission, isSupported } = useNotifications();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/inventory', label: 'Inventory', icon: Package },
    { path: '/shopping-lists', label: 'Shopping Lists', icon: ShoppingCart },
  ];

  return (
    <div className="min-h-[100dvh] flex bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="p-6 border-b border-sidebar-border">
          <h1 className="text-2xl font-bold text-sidebar-foreground tracking-tight">
            PantryPal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Smart household inventory
          </p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;

            return (
              <Link
                key={item.path}
                href={item.path}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
                  isActive
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Notification permission prompt */}
        {isSupported && permission !== 'denied' && (
          <div className="p-4 border-t border-sidebar-border">
            {permission === 'granted' ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
                <Bell className="h-3.5 w-3.5 text-sidebar-primary" />
                <span>Out-of-stock alerts on</span>
              </div>
            ) : (
              <button
                onClick={requestPermission}
                className="flex items-center gap-2 w-full px-4 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all"
                data-testid="button-enable-notifications"
              >
                <BellOff className="h-4 w-4" />
                Enable alerts
              </button>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-8">{children}</div>
      </main>
    </div>
  );
}
