"use client";

import type { CheckoutSessionAnalytics } from "@sokosumi/core-client";
import { useTrackPurchase } from "@/hooks/effects/use-track-purchase";

interface PurchaseTrackerProps {
  checkoutSession: CheckoutSessionAnalytics;
}

export function PurchaseTracker({ checkoutSession }: PurchaseTrackerProps) {
  useTrackPurchase(checkoutSession);

  return null;
}
