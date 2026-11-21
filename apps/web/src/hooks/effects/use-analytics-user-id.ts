"use client";

import { useEffect, useRef } from "react";

/**
 * Pushes `{ event: "set_user_id", user_id }` into `window.dataLayer` whenever
 * `userId` changes from the last pushed value. Initial `null` is skipped;
 * transitioning back to `null` clears the GA4 user id on logout.
 */
export function useAnalyticsUserId(userId: string | null): void {
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (userId === last.current) return;
    last.current = userId;

    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ event: "set_user_id", user_id: userId });
  }, [userId]);
}
