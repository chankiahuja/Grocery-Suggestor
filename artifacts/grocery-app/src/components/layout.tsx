import { Link, useLocation } from "wouter";
import { Home, Package, ShoppingCart, Leaf } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationCenter } from "@/components/notification-center";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const navItems = [
    { path: "/", label: "Dashboard", icon: Home },
    { path: "/inventory", label: "Inventory", icon: Package },
    { path: "/shopping-lists", label: "Shopping Lists", icon: ShoppingCart },
  ];
  const section = location.startsWith("/shopping-lists")
    ? "Shopping Lists"
    : location === "/inventory"
      ? "Home inventory"
      : "Overview";
  const base = import.meta.env?.BASE_URL ?? "/";
  return (
    <div className="pantry-shell min-h-[100dvh] bg-background">
      <header className="pantry-header">
        <div className="pantry-header-inner">
          <Link href="/" aria-label="Pantry Pal home" className="pantry-brand">
            <img
              src={`${base}brand/pantry-pal-logo.svg`}
              alt="Pantry Pal"
              width="220"
              height="62"
            />
          </Link>
          <nav aria-label="Main navigation" className="pantry-navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.path === "/"
                  ? location === "/"
                  : location.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={cn("pantry-nav-link", active && "is-active")}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="pantry-header-actions">
            <Link href="/login" className="pantry-sign-in">
              Sign in
            </Link>
            <span className="pantry-household">
              <Leaf className="h-4 w-4" /> My household
            </span>
            <NotificationCenter />
          </div>
        </div>
      </header>
      <main className="pantry-main">
        <div className="pantry-breadcrumb">
          <span>My household</span>
          <span aria-hidden="true">/</span>
          <span>{section}</span>
        </div>
        {import.meta.env?.MODE === "mock" && (
          <div className="pantry-demo">
            <span>
              <span className="pantry-status-dot" /> Demo mode · Sample data
              saved in this browser
            </span>
            <button
              className="underline underline-offset-4"
              onClick={() => {
                localStorage.removeItem("pantrypal-demo-v1");
                localStorage.removeItem("pantrypal-seen-notifications");
                window.location.reload();
              }}
            >
              Reset demo data
            </button>
          </div>
        )}
        <div className="pantry-content">{children}</div>
        <footer className="pantry-footer">
          <span>
            <Leaf className="h-3 w-3" /> A little more in order.
          </span>
          <span>Thoughtful shopping. Less waste.</span>
        </footer>
      </main>
    </div>
  );
}
