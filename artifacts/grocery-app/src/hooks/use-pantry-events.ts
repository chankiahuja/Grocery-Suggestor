import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Events invalidate cached server state; existing polling recovers missed events. */
export function usePantryEvents() {
  const client = useQueryClient();
  useEffect(() => {
    if (import.meta.env?.MODE === "mock" || typeof EventSource === "undefined")
      return;
    const source = new EventSource("/api/notifications/stream");
    const refresh = (event: MessageEvent<string>) => {
      try {
        if (JSON.parse(event.data).type !== "heartbeat") {
          void client.invalidateQueries();
        }
      } catch {
        /* Ignore malformed events; polling remains available. */
      }
    };
    source.addEventListener("pantry-event", refresh);
    return () => source.close();
  }, [client]);
}
