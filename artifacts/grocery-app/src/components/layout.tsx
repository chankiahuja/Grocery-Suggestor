import { Link, useLocation } from 'wouter';
import { Home, Package, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationCenter } from '@/components/notification-center';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/inventory', label: 'Inventory', icon: Package },
    { path: '/shopping-lists', label: 'Shopping Lists', icon: ShoppingCart },
  ];

  return (
    <div className="min-h-[100dvh] flex bg-background">
      {/* Sidebar */}
      <aside className="w-14 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col sm:w-16 md:w-64">
        <div className="flex flex-col items-center gap-3 border-b border-sidebar-border p-2 md:flex-row md:items-start md:justify-between md:gap-2 md:p-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-sidebar-foreground tracking-tight">
              <span className="md:hidden">P</span>
              <span className="hidden md:inline">PantryPal</span>
            </h1>
            <p className="mt-1 hidden text-sm text-muted-foreground md:block">
              Smart household inventory
            </p>
          </div>
          <NotificationCenter />
        </div>

        <nav className="flex-1 space-y-1 p-2 md:p-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;

            return (
              <Link
                key={item.path}
                href={item.path}
                aria-label={item.label}
                className={cn(
                  'flex items-center justify-center gap-3 rounded-lg px-2 py-2.5 text-sm font-medium transition-all md:justify-start md:px-4',
                  isActive
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon className="h-5 w-5" />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>


      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl p-4 sm:p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
