import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Redirect, useLocation } from "wouter";

// Preview navigation only; this does not authenticate or protect API requests.
const PreviewAccess = createContext({ complete: () => {}, logout: () => {} });
export const useCompletePreview = () => useContext(PreviewAccess).complete;
export const useLogoutPreview = () => useContext(PreviewAccess).logout;

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
    <PreviewAccess.Provider
      value={{
        complete: () => setCompleted(true),
        logout: () => setCompleted(false),
      }}
    >
      {children}
    </PreviewAccess.Provider>
  );
}
