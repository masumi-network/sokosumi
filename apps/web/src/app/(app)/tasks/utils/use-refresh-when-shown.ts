import { useEffect, useRef } from "react";
import { useDebouncedCallback } from "use-debounce";
import {
  TASKS_BOARD_REFRESH_DEBOUNCE_MS,
  TASKS_BOARD_REFRESH_MAX_WAIT_MS,
} from "@/app/tasks/constants";

/**
 * A debounced refresh for realtime events. A tab in the background does not
 * refresh for every event: it notes that something changed and refreshes
 * once when it is shown again.
 */
export function useRefreshWhenShown(refresh: () => void): () => void {
  const debounced = useDebouncedCallback(
    refresh,
    TASKS_BOARD_REFRESH_DEBOUNCE_MS,
    { maxWait: TASKS_BOARD_REFRESH_MAX_WAIT_MS },
  );
  const changedWhileHiddenRef = useRef(false);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState !== "visible" ||
        !changedWhileHiddenRef.current
      )
        return;
      changedWhileHiddenRef.current = false;
      debounced();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      debounced.cancel();
    };
  }, [debounced]);

  return () => {
    if (document.visibilityState === "hidden") {
      changedWhileHiddenRef.current = true;
      return;
    }
    debounced();
  };
}
