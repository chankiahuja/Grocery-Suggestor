import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getAuthSession, logoutSession, setCsrfToken, setUnauthorizedHandler, type AuthSession } from "@workspace/api-client-react";

const PreviewAccess = createContext({ demo: false, complete: () => {}, signedIn: (_session: AuthSession) => {}, logout: async () => {} });
export const useSessionAccess = () => useContext(PreviewAccess);
export const useCompletePreview = () => useContext(PreviewAccess).complete;
export const useLogoutPreview = () => useContext(PreviewAccess).logout;

export function LoginGate({ children, preview = import.meta.env?.MODE === "mock" }: { children: ReactNode; preview?: boolean }) {
  const [location, navigate] = useLocation();
  const client = useQueryClient();
  const [ready, setReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setReady(false);
    setError("");
    if (preview) {
      navigate("/login", { replace: true });
      setReady(true);
      return;
    }
    setUnauthorizedHandler(() => {
      setCompleted(false);
      setReady(false);
      client.clear();
      navigate("/login", { replace: true });
      setRetry(value => value + 1);
    });
    void getAuthSession({ signal: AbortSignal.timeout(10_000) }).then(session => {
      if (!active) return;
      setCsrfToken(session.csrfToken);
      setCompleted(session.authenticated);
      setReady(true);
    }).catch(() => { if (active) setError("Unable to check your session. Check the connection and try again."); });
    return () => { active = false; setUnauthorizedHandler(null); };
  }, [preview, retry]);

  if (error) return <main role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Retry connection</button></main>;
  if (!ready) return <main role="status">Checking your session…</main>;
  if (!completed && location !== "/login" && location !== "/signup") {
    return <Redirect to="/login" replace />;
  }
  if (completed && (location === "/login" || location === "/signup" || location === "/")) return <Redirect to="/dashboard" replace />;
  return (
    <PreviewAccess.Provider
      value={{
        demo: preview,
        complete: () => { if (preview) setCompleted(true); },
        signedIn: session => { setCsrfToken(session.csrfToken); client.clear(); setCompleted(session.authenticated); },
        logout: async () => {
          if (!preview) { const session = await logoutSession(); setCsrfToken(session.csrfToken); }
          setCompleted(false);
          client.clear();
        },
      }}
    >
      {children}
    </PreviewAccess.Provider>
  );
}
