"use client";

import { useEffect } from "react";

import {
  CONSENT_CHANGE_EVENT,
  type ConsentChoice,
  readConsent,
} from "@/lib/analytics/consent";
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

/**
 * Fires at most once per checkout session id: in memory for this JS realm, and
 * in sessionStorage so reloading the Stripe return URL does not fire again.
 * An id is only marked once the event was pushed with analytics consent
 * granted; GTM drops it otherwise, so marking earlier would lose it for good.
 */
const firedPurchaseSessionIds = new Set<string>();
const FIRED_STORAGE_PREFIX = "sokosumi_purchase_fired:";

export function resetFiredPurchaseSessionIdsForTests() {
  firedPurchaseSessionIds.clear();
  window.sessionStorage.clear();
}

function hasFired(sessionId: string): boolean {
  if (firedPurchaseSessionIds.has(sessionId)) {
    return true;
  }
  try {
    return (
      window.sessionStorage.getItem(FIRED_STORAGE_PREFIX + sessionId) !== null
    );
  } catch {
    return false;
  }
}

function markFired(sessionId: string) {
  firedPurchaseSessionIds.add(sessionId);
  try {
    window.sessionStorage.setItem(FIRED_STORAGE_PREFIX + sessionId, "1");
  } catch {
    // Storage blocked: the in-memory set still covers this page load.
  }
}

export function PurchaseTracker({ checkoutSession }: PurchaseTrackerProps) {
  useEffect(() => {
    const { session_id, currency, value, items } =
      mapCheckoutSession(checkoutSession);

    function fireIfGranted(consent: ConsentChoice | null) {
      if (!consent?.analytics || hasFired(session_id)) {
        return;
      }
      markFired(session_id);
      fireGTMEvent.purchase(session_id, currency, value, items);
    }

    fireIfGranted(readConsent());
    if (hasFired(session_id)) {
      return;
    }

    // No decision yet (or refused): wait for the banner. A refusal never fires.
    function handleConsentChange(event: Event) {
      fireIfGranted((event as CustomEvent<ConsentChoice>).detail);
    }
    window.addEventListener(CONSENT_CHANGE_EVENT, handleConsentChange);
    return () =>
      window.removeEventListener(CONSENT_CHANGE_EVENT, handleConsentChange);
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
