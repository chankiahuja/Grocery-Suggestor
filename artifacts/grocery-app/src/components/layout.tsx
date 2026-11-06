import { Link, useLocation } from "wouter";
import { Home, Package, ShoppingCart, Tags, Leaf } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationCenter } from "@/components/notification-center";
import { useLogoutPreview } from "@/lib/preview-access";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const logout = useLogoutPreview();
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const isShoppingListDetail = /^\/shopping-lists\/[^/]+$/.test(location);
  const navItems = [
    { path: "/dashboard", label: "Dashboard", icon: Home },
    { path: "/inventory", label: "Inventory", icon: Package },
    { path: "/shopping-lists", label: "Shopping Lists", icon: ShoppingCart },
    { path: "/compare-prices", label: "Compare Prices", icon: Tags },
  ];
  const section = location.startsWith("/shopping-lists")
    ? "Shopping Lists"
    : location.startsWith("/compare-prices")
      ? "Compare Prices"
    : location.startsWith("/inventory")
      ? "Home inventory"
      : "Overview";
  const sectionHref =
    section === "Shopping Lists"
      ? "/shopping-lists"
      : section === "Compare Prices"
        ? "/compare-prices"
        : section === "Home inventory"
          ? "/inventory"
          : "/dashboard";
  const base = import.meta.env?.BASE_URL ?? "/";
  return (
    <div className="pantry-shell min-h-[100dvh] bg-background">
      <header className="pantry-header">
        <div className="pantry-header-inner">
          <Link
            href="/dashboard"
            aria-label="Pantry Pal home"
            className="pantry-brand"
          >
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
                item.path === "/dashboard"
                  ? location === "/dashboard"
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
            <button
              type="button"
              className="pantry-sign-in"
              disabled={loggingOut}
              onClick={async () => {
                setLoggingOut(true);
                setLogoutError("");
                try {
                  await logout();
                  queryClient.clear();
                  navigate("/login", { replace: true });
                } catch { setLogoutError("Logout could not be confirmed. Please try again."); }
                finally { setLoggingOut(false); }
              }}
            >
              Logout
            </button>
            {logoutError && <span role="alert">{logoutError}</span>}
            <span className="pantry-household">
              <Leaf className="h-4 w-4" /> My household
            </span>
            <NotificationCenter />
          </div>
        </div>
      </header>
      <main className="pantry-main">
        <nav aria-label="Breadcrumb" className="pantry-breadcrumb">
          <Link href="/dashboard">My household</Link>
          <span aria-hidden="true">/</span>
          <Link href={sectionHref} aria-current={sectionHref === location ? "page" : undefined}>
            {section}
          </Link>
          {isShoppingListDetail && (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page">List details</span>
            </>
          )}
        </nav>
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
