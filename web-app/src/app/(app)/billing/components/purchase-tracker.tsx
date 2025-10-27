"use client";

import { useEffect } from "react";

import { CheckoutSessionData } from "@/lib/clients";
import { fireGTMEvent } from "@/lib/gtm-events";

interface PurchaseTrackerProps {
  checkoutSession: CheckoutSessionData;
}

export default function PurchaseTracker({
  checkoutSession,
}: PurchaseTrackerProps) {
  // Effect is necessary: Analytics tracking when component is displayed
  // Fires once on mount to track purchase conversion
  useEffect(() => {
    const { session_id, isWelcomePromotion } = checkoutSession;

    if (isWelcomePromotion) {
      fireGTMEvent.freeCreditPurchase(session_id);
    } else {
      fireGTMEvent.purchase(checkoutSession);
    }
  }, [checkoutSession]);

  return null;
}
