import { lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Router as WouterRouter } from "wouter";
import { LoginGate } from "@/lib/preview-access";
import { AdjustmentFeedbackProvider } from "@/components/adjustment-feedback";
import { RouteLoadingBoundary } from "@/components/route-loading-boundary";

const NotFound = lazy(() => import("@/pages/not-found"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Inventory = lazy(() => import("@/pages/inventory"));
const ShoppingLists = lazy(() => import("@/pages/shopping-lists"));
const ShoppingListDetail = lazy(() => import("@/pages/shopping-list-detail"));
const ComparePrices = lazy(() => import("@/pages/compare-prices"));
const Auth = lazy(() => import("@/pages/auth"));
const Landing = lazy(() => import("@/pages/landing"));
const Contact = lazy(() => import("@/pages/contact"));
const Privacy = lazy(() => import("@/pages/privacy"));
const AccountSettings = lazy(() => import("@/pages/account"));

const queryClient = new QueryClient();

export function AppRoutes({ preview }: { preview?: boolean } = {}) {
  return (
    <LoginGate preview={preview}>
      <RouteLoadingBoundary>
        <Switch>
          <Route path="/login" component={Auth} />
          <Route path="/signup" component={Auth} />
          <Route path="/" component={Landing} />
          <Route path="/contact" component={Contact} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/account" component={AccountSettings} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/inventory" component={Inventory} />
          <Route path="/shopping-lists" component={ShoppingLists} />
          <Route path="/shopping-lists/:id" component={ShoppingListDetail} />
          <Route path="/compare-prices" component={ComparePrices} />
          <Route component={NotFound} />
        </Switch>
      </RouteLoadingBoundary>
    </LoginGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AdjustmentFeedbackProvider><AppRoutes /></AdjustmentFeedbackProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
