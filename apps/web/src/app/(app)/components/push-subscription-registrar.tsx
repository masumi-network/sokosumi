"use client";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { ensurePushServiceWorkerIfSubscribed } from "@/lib/services/push-subscription.service";

/**
 * Registers the push service worker on app load when a local subscription
 * already exists, so closed-tab pushes continue to work after reload.
 */
export function PushSubscriptionRegistrar() {
  useMountEffect(() => {
    void ensurePushServiceWorkerIfSubscribed();
  });

  return null;
}
