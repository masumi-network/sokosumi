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
