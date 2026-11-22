"use client";

import { useEffect, useRef, useState } from "react";

export function useWorkspaceCalendarRenderEpoch(): number {
  const [calendarRenderEpoch, setCalendarRenderEpoch] = useState(0);
  const hasActivatedRef = useRef(false);

  useEffect(() => {
    // Defer past React StrictMode's synchronous setup -> cleanup -> setup
    // dev-mode cycle: only the microtask from the setup that survives (isn't
    // cancelled by an immediate synthetic cleanup) marks activation or
    // recreates the Calendar views once for a real reactivation.
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      if (hasActivatedRef.current) {
        setCalendarRenderEpoch((epoch) => epoch + 1);
        return;
      }
      hasActivatedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return calendarRenderEpoch;
}
