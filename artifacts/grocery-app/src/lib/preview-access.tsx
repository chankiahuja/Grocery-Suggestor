import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Redirect, useLocation } from "wouter";

// Preview navigation only; this does not authenticate or protect API requests.
const PreviewAccess = createContext(() => {});
export const useCompletePreview = () => useContext(PreviewAccess);

export function LoginGate({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [ready, setReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    navigate("/login", { replace: true });
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!completed && location !== "/login" && location !== "/signup") {
    return <Redirect to="/login" replace />;
  }
  return (
    <PreviewAccess.Provider value={() => setCompleted(true)}>
      {children}
    </PreviewAccess.Provider>
  );
}
