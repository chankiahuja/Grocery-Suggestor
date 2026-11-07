import { Component, Suspense, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

class PageErrorBoundary extends Component<
  { path: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: Readonly<{ path: string; children: ReactNode }>) {
    if (previous.path !== this.props.path && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <main role="alert" className="p-8 text-center space-y-4">
          <p>We couldn't open this page. Check your connection and reload to try again.</p>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </main>
      );
    }
    return this.props.children;
  }
}

export function RouteLoadingBoundary({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  return (
    <PageErrorBoundary path={path}>
      <Suspense fallback={<main role="status" className="p-8 text-center">Loading page…</main>}>
        {children}
      </Suspense>
    </PageErrorBoundary>
  );
}
