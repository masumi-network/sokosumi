"use client";

import { useAnalyticsUserId } from "@/hooks/effects/use-analytics-user-id";
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

  useAnalyticsUserId(userId);

  return null;
}
