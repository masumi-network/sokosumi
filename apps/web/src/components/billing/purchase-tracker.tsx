"use client";

import { useEffect } from "react";

import type { CheckoutSessionAnalytics } from "@/lib/clients/generated/core";
import { fireGTMEvent } from "@/lib/gtm-events";

interface PurchaseTrackerProps {
  checkoutSession: CheckoutSessionAnalytics;
}

export interface CheckoutSessionData {
  session_id: string;
  currency: string | null;
  value: number | null;
  items: {
    item_id: string;
    item_name: string;
    quantity: number | null;
  }[];
}

/** Fires at most once per checkout session id for the lifetime of this JS realm. */
const firedPurchaseSessionIds = new Set<string>();

export function resetFiredPurchaseSessionIdsForTests() {
  firedPurchaseSessionIds.clear();
}

export function PurchaseTracker({ checkoutSession }: PurchaseTrackerProps) {
  useEffect(() => {
    const { session_id, currency, value, items } =
      mapCheckoutSession(checkoutSession);
    if (firedPurchaseSessionIds.has(session_id)) {
      return;
    }
    firedPurchaseSessionIds.add(session_id);
    fireGTMEvent.purchase(session_id, currency, value, items);
  }, [checkoutSession]);

  return null;
}

function mapCheckoutSession(
  session: CheckoutSessionAnalytics,
): CheckoutSessionData {
  return {
    session_id: session.sessionId,
    currency: session.currency,
    value: session.value,
    items: session.items.map((item) => ({
      item_id: item.itemId,
      item_name: item.itemName,
      quantity: item.quantity,
    })),
  };
}
