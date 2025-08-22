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
    const { session, isWelcomePromotion } = checkoutSession;

    if (isWelcomePromotion) {
      console.log("Welcome promotion");
      fireGTMEvent.freeCreditPurchase(session.id);
    } else {
      console.log("Paid purchase");
      fireGTMEvent.purchase(checkoutSession);
    }
  }, [checkoutSession]);

  return null;
}
