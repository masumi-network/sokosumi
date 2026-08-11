"use client";

import { useEffect, useRef } from "react";

import { useSession } from "@/lib/auth/auth.client";

/**
 * Ties GA4 activity across sessions and devices to a stable, opaque Sokosumi
 * user id — never an email or name. Pushed into the dataLayer so the GA4
 * Configuration tag in GTM can read it (field `user_id` = {{DLV - user_id}}).
 * Cleared on logout so a shared browser does not attribute the next visitor to
 * the previous user. See apps/web/TRACKING.md.
 */
export function AnalyticsUserId() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (userId === last.current) return;
    last.current = userId;

    const w = window as unknown as { dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push({ event: "set_user_id", user_id: userId });
  }, [userId]);

  return null;
}
