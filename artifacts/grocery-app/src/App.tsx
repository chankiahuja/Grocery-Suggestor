import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Inventory from "@/pages/inventory";
import ShoppingLists from "@/pages/shopping-lists";
import ShoppingListDetail from "@/pages/shopping-list-detail";
import Auth from "@/pages/auth";
import { Route, Switch, Redirect, Router as WouterRouter } from "wouter";
import { LoginGate } from "@/lib/preview-access";

const queryClient = new QueryClient();

export function AppRoutes() {
  return (
    <LoginGate><Switch>
      <Route path="/login" component={Auth} />
      <Route path="/signup" component={Auth} />
      <Route path="/"><Redirect to="/login" replace /></Route>
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/inventory" component={Inventory} />
      <Route path="/shopping-lists" component={ShoppingLists} />
      <Route path="/shopping-lists/:id" component={ShoppingListDetail} />
      <Route component={NotFound} />
    </Switch></LoginGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
