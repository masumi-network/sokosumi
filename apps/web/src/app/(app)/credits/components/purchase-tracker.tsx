"use client";

import { useEffect } from "react";
import type Stripe from "stripe";

import { fireGTMEvent } from "@/lib/gtm-events";

interface PurchaseTrackerProps {
  checkoutSession: Stripe.Checkout.Session;
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

export default function PurchaseTracker({
  checkoutSession,
}: PurchaseTrackerProps) {
  // Effect is necessary: Analytics tracking when component is displayed
  // Fires once on mount to track purchase conversion
  useEffect(() => {
    const { session_id, currency, value, items } =
      mapCheckoutSession(checkoutSession);
    fireGTMEvent.purchase(session_id, currency, value, items);
  }, [checkoutSession]);

  return null;
}

function mapCheckoutSession(
  session: Stripe.Checkout.Session,
): CheckoutSessionData {
  const lineItems = session.line_items?.data ?? [];
  const items = lineItems
    .map((item) => {
      if (
        item.price?.product &&
        typeof item.price.product === "object" &&
        "id" in item.price.product &&
        "name" in item.price.product
      ) {
        return {
          item_id: item.price.product.id,
          item_name: item.price.product.name,
          quantity: item.quantity,
        };
      }
    })
    .filter(Boolean) as {
    item_id: string;
    item_name: string;
    quantity: number;
  }[];

  return {
    session_id: session.id,
    currency: session.currency,
    items,
    value: session.amount_total,
  };
}
