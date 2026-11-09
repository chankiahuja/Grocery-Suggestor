import { Link, useLocation } from "wouter";
import { Home, Package, ShoppingCart, Tags, Leaf, UserRound, LogOut, ChevronDown, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationCenter } from "@/components/notification-center";
import { useLogoutPreview, useSessionAccess } from "@/lib/preview-access";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuickFeedbackDialog } from "@/components/quick-feedback-dialog";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const logout = useLogoutPreview();
  const { account, demo } = useSessionAccess();
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [accountDetailsOpen, setAccountDetailsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const logoutPending = useRef(false);
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
  const accountEmail = account?.email || (demo ? "Preview session" : "Email not available");
  const accountName = account?.name?.trim() || account?.email?.split("@")[0] || (demo ? "Demo account" : "My account");
  const initials = account?.name?.trim()
    ? account.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()
    : account?.email?.[0]?.toUpperCase() || (demo ? "D" : "?");

  async function handleLogout() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
      queryClient.clear();
      navigate("/login", { replace: true });
    } catch {
      setLogoutError("Logout could not be confirmed. Please try again.");
    } finally {
      logoutPending.current = false;
      setLoggingOut(false);
    }
  }

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
            <span className="pantry-household">
              <Leaf className="h-4 w-4" /> My household
            </span>
            <NotificationCenter />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button ref={accountTrigger} type="button" className="pantry-account-trigger" disabled={loggingOut} aria-label={`Account menu for ${accountName}`}>
                  <span className="pantry-account-avatar" aria-hidden="true">{initials}</span>
                  <span className="pantry-account-name">{accountName}</span>
                  <ChevronDown className="pantry-account-chevron" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={10} className="pantry-account-menu">
                <div className="pantry-account-summary">
                  <span className="pantry-account-avatar pantry-account-avatar-large" aria-hidden="true">{initials}</span>
                  <span className="pantry-account-summary-text">
                    <strong>{account?.name?.trim() || accountName}</strong>
                    <span>{accountEmail}</span>
                  </span>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="pantry-account-menu-item" onSelect={() => setAccountDetailsOpen(true)}>
                  <UserRound aria-hidden="true" /> Account details
                </DropdownMenuItem>
                <DropdownMenuItem className="pantry-account-menu-item" onSelect={() => setFeedbackOpen(true)}>
                  <MessageSquareText aria-hidden="true" /> Share feedback
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="pantry-account-menu-item pantry-account-logout" disabled={loggingOut} onSelect={() => void handleLogout()}>
                  <LogOut aria-hidden="true" /> {loggingOut ? "Logging out…" : "Log out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {logoutError && <span className="pantry-logout-error" role="alert">{logoutError}</span>}
          </div>
        </div>
      </header>
      <Dialog open={accountDetailsOpen} onOpenChange={setAccountDetailsOpen}>
        <DialogContent className="pantry-account-dialog" onCloseAutoFocus={event => {
          event.preventDefault();
          accountTrigger.current?.focus();
        }}>
          <DialogHeader>
            <DialogTitle>Account details</DialogTitle>
            <DialogDescription>{demo ? "This is a demo preview, not a signed-in account." : "Your PantryPal sign-in information."}</DialogDescription>
          </DialogHeader>
          <dl className="pantry-account-details">
            <div><dt>Name</dt><dd>{account?.name?.trim() || (demo ? "Demo account" : "Not provided")}</dd></div>
            <div><dt>Email</dt><dd>{accountEmail}</dd></div>
          </dl>
        </DialogContent>
      </Dialog>
      {feedbackOpen && <QuickFeedbackDialog email={account?.email} open onOpenChange={setFeedbackOpen} />}
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
          <Link href="/contact">Contact &amp; Feedback</Link>
        </footer>
      </main>
    </div>
  );
}
