/**
 * Cookie-consent contract, shared by the banner and the Consent Mode init.
 *
 * The same cookie shape is written by the marketing site (sokosumi-landing,
 * assets/consent.js). It is scoped to `.sokosumi.com`, so a decision made on
 * sokosumi.com also covers app.sokosumi.com and vice versa — the visitor is
 * asked once. See apps/web/TRACKING.md for the whole design.
 *
 * Nothing here loads a third-party CMP; it is a few small functions that flip
 * Google Consent Mode v2 based on the visitor's choice.
 */

export const CONSENT_COOKIE = "sokosumi_consent";
export const CONSENT_VERSION = 1;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 182; // ~6 months, then we ask again

export interface ConsentChoice {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
}

interface StoredConsent extends ConsentChoice {
  ts: number;
  v: number;
}

/**
 * gtag() shim. GA/GTM only treat a pushed `arguments` object as a command, so
 * a plain array is ignored — we rebuild the arguments object via apply().
 */
function gtag(...args: unknown[]): void {
  if (typeof window === "undefined") return;
  const dataLayer = (window.dataLayer = window.dataLayer ?? []);
  function push() {
    dataLayer.push(arguments);
  }
  (push as (...a: unknown[]) => void).apply(null, args);
}

/** sokosumi.com + app.sokosumi.com share one decision; elsewhere stay host-only. */
function cookieDomainSuffix(): string {
  if (typeof window === "undefined") return "";
  return /(^|\.)sokosumi\.com$/.test(window.location.hostname)
    ? "; domain=.sokosumi.com"
    : "";
}

/**
 * Secure over HTTPS. Without it a plain-HTTP response on the same domain can
 * overwrite the cookie with granted values, and readConsent() would restore
 * them — turning tracking on for someone who never agreed. Omitted on http so
 * local development still works.
 */
function cookieSecureSuffix(): string {
  if (typeof window === "undefined") return "";
  return window.location.protocol === "https:" ? "; Secure" : "";
}

export function readConsent(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )sokosumi_consent=([^;]+)/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as StoredConsent;
    // A choice recorded against an older schema is not a choice about the
    // current categories — treat it as no decision so the banner asks again.
    // Without this check CONSENT_VERSION was written but never honoured.
    if (parsed.v !== CONSENT_VERSION) return null;
    return {
      necessary: true,
      analytics: !!parsed.analytics,
      marketing: !!parsed.marketing,
    };
  } catch {
    return null;
  }
}

export function writeConsent(
  choice: Omit<ConsentChoice, "necessary">,
): ConsentChoice {
  const value: StoredConsent = {
    necessary: true,
    analytics: !!choice.analytics,
    marketing: !!choice.marketing,
    ts: Date.now(),
    v: CONSENT_VERSION,
  };
  if (typeof document !== "undefined") {
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
      JSON.stringify(value),
    )}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${cookieDomainSuffix()}${cookieSecureSuffix()}`;
  }
  return value;
}

/**
 * Flip Google Consent Mode v2 to match the choice, and fire the `consent_status` event the GTM container gates on (e.g. to re-fire a tag now that
 * consent exists).
 */
export function applyConsentMode(choice: ConsentChoice): void {
  gtag("consent", "update", {
    analytics_storage: choice.analytics ? "granted" : "denied",
    ad_storage: choice.marketing ? "granted" : "denied",
    ad_user_data: choice.marketing ? "granted" : "denied",
    ad_personalization: choice.marketing ? "granted" : "denied",
  });
  if (typeof window !== "undefined") {
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({
      event: "consent_status",
      consent_analytics: choice.analytics ? "granted" : "denied",
      consent_marketing: choice.marketing ? "granted" : "denied",
    });
  }
}
