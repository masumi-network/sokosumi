"use client";

import { useEffect, useState } from "react";

import {
  applyConsentMode,
  type ConsentChoice,
  readConsent,
  writeConsent,
} from "@/lib/analytics/consent";
import {
  authProductName,
  buildSignedOAuthQueryFromSearchParams,
  oauthRequestBrand,
} from "@/lib/auth/auth.utils";

/** Reopen the preferences panel from anywhere (e.g. a footer link). */
const OPEN_CONSENT_EVENT = "sokosumi:open-consent";

export function openCookieConsentPreferences() {
  window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
}

/**
 * Hydrates cookie consent banner state from the consent cookie and OAuth
 * product query on mount, listens for reopen requests, and writes choices back
 * to the consent cookie and Google Consent Mode v2.
 */
export function useCookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [product, setProduct] = useState(() => authProductName(undefined));

  useEffect(() => {
    // A sign-in page opened from another product names that product.
    const oauthQuery = buildSignedOAuthQueryFromSearchParams(
      new URLSearchParams(window.location.search),
    );
    setProduct(
      authProductName(oauthQuery ? oauthRequestBrand(oauthQuery) : undefined),
    );
    const stored = readConsent();
    if (!stored) setVisible(true);

    const reopen = () => {
      const current = readConsent();
      setAnalytics(current?.analytics ?? false);
      setMarketing(current?.marketing ?? false);
      setExpanded(true);
      setVisible(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  const decide = (choice: Omit<ConsentChoice, "necessary">) => {
    const stored = writeConsent(choice);
    applyConsentMode(stored);
    setVisible(false);
    setExpanded(false);
  };

  return {
    visible,
    expanded,
    setExpanded,
    analytics,
    setAnalytics,
    marketing,
    setMarketing,
    product,
    decide,
  };
}
