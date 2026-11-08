import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetInventoryStatsQueryKey, getGetGrocerySuggestionsQueryKey } from "@workspace/api-client-react";

/** Refresh date-based attention even when no inventory mutation occurs overnight. */
export function useUtcDate() {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const client = useQueryClient();
  const previous = useRef(day);
  useEffect(() => {
    const check = () => setDay(new Date().toISOString().slice(0, 10));
    const timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, []);
  useEffect(() => {
    if (previous.current === day) return;
    previous.current = day;
    void client.invalidateQueries({ queryKey: getGetInventoryStatsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetGrocerySuggestionsQueryKey() });
  }, [day, client]);
  return day;
}
