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
/** Window event dispatched after a banner choice is applied; `detail` is the ConsentChoice. */
export const CONSENT_CHANGE_EVENT = "sokosumi:consent-change";
/** Shared denied-by-default Google Consent Mode v2 payload used by both ConsentModeInit and client fallback. */
export const CONSENT_MODE_DEFAULTS = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  functionality_storage: "granted",
  security_storage: "granted",
  wait_for_update: 500,
} as const;
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
export function cookieDomainSuffix(): string {
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
export function cookieSecureSuffix(): string {
  if (typeof window === "undefined") return "";
  return window.location.protocol === "https:" ? "; Secure" : "";
}

export function readConsent(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]+)`),
  );
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as StoredConsent;
    // Mirror the beforeInteractive inline script: a stale schema or a
    // hand-crafted cookie must not count as a decision. Coercing with !!
    // would treat "false" as granted and hide the banner.
    if (
      parsed.v !== CONSENT_VERSION ||
      typeof parsed.analytics !== "boolean" ||
      typeof parsed.marketing !== "boolean"
    ) {
      return null;
    }
    return {
      necessary: true,
      analytics: parsed.analytics,
      marketing: parsed.marketing,
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

function pushConsentUpdate(choice: ConsentChoice): void {
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

export function hasConsentModeDefault(dataLayer?: unknown[]): boolean {
  const entries =
    dataLayer ?? (typeof window !== "undefined" ? window.dataLayer : undefined);
  if (!Array.isArray(entries)) return false;

  return entries.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      Reflect.get(entry, 0) === "consent" &&
      Reflect.get(entry, 1) === "default",
  );
}

/**
 * Ensures Google Consent Mode v2 denied defaults (plus any stored choice and
 * privacy flags) are queued in `window.dataLayer` before GTM/GA mount.
 *
 * Normally `ConsentModeInit` (`beforeInteractive`) runs at document bootstrap,
 * making this a no-op. When a document boots on a telemetry-blocked route
 * (e.g. `/reset-password`) and later soft-navigates to a tracked route, Next.js
 * does not re-run `beforeInteractive` scripts; calling this before mounting
 * Google tags guarantees the denied default is still queued first.
 */
export function ensureConsentModeDefault(): boolean {
  if (typeof window === "undefined") return false;
  if (hasConsentModeDefault(window.dataLayer)) return false;

  gtag("consent", "default", CONSENT_MODE_DEFAULTS);
  const stored = readConsent();
  if (stored) {
    pushConsentUpdate(stored);
  }
  gtag("set", "url_passthrough", true);
  gtag("set", "ads_data_redaction", true);
  return true;
}

/**
 * Flip Google Consent Mode v2 to match the choice, and fire the `consent_status` event the GTM container gates on (e.g. to re-fire a tag now that
 * consent exists).
 */
export function applyConsentMode(choice: ConsentChoice): void {
  pushConsentUpdate(choice);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ConsentChoice>(CONSENT_CHANGE_EVENT, { detail: choice }),
    );
  }
}
