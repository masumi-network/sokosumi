import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyConsentMode,
  CONSENT_CHANGE_EVENT,
  CONSENT_COOKIE,
  CONSENT_MODE_DEFAULTS,
  CONSENT_VERSION,
  denyConsentMode,
  ensureConsentModeDefault,
  hasConsentModeDefault,
  hasLoadedGoogleTags,
  readConsent,
  restorePersistedConsentMode,
  setGoogleAnalyticsDisabled,
  writeConsent,
} from "./consent";

function setLocation(hostname: string, protocol: "http:" | "https:") {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hostname, protocol },
  });
}

describe("readConsent", () => {
  beforeEach(() => {
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  });

  it("returns null when the cookie is missing", () => {
    expect(readConsent()).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    document.cookie = `${CONSENT_COOKIE}=not-json; Path=/`;
    expect(readConsent()).toBeNull();
  });

  it("returns null for a stale schema version", () => {
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        ts: 1,
        v: CONSENT_VERSION - 1,
      }),
    )}; Path=/`;
    expect(readConsent()).toBeNull();
  });

  it("returns null when flags are not booleans", () => {
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        necessary: true,
        analytics: "false",
        marketing: false,
        ts: 1,
        v: CONSENT_VERSION,
      }),
    )}; Path=/`;
    expect(readConsent()).toBeNull();
  });

  it("returns the stored choice when version and flags are valid", () => {
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        ts: 1,
        v: CONSENT_VERSION,
      }),
    )}; Path=/`;
    expect(readConsent()).toEqual({
      necessary: true,
      analytics: true,
      marketing: false,
    });
  });
});

describe("writeConsent", () => {
  afterEach(() => {
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  });

  it("writes a versioned cookie that readConsent accepts", () => {
    setLocation("localhost", "http:");
    writeConsent({ analytics: true, marketing: false });
    expect(readConsent()).toEqual({
      necessary: true,
      analytics: true,
      marketing: false,
    });
    expect(document.cookie).toContain(CONSENT_COOKIE);
  });

  it("adds Secure on https and the shared domain on sokosumi hosts", () => {
    setLocation("app.sokosumi.com", "https:");
    const assignments: string[] = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
      assignments.push(value);
    });

    writeConsent({ analytics: false, marketing: true });

    expect(assignments.at(-1)).toContain("; Secure");
    expect(assignments.at(-1)).toContain("; domain=.sokosumi.com");
    expect(assignments.at(-1)).toContain("SameSite=Lax");
    vi.restoreAllMocks();
  });
});

describe("applyConsentMode", () => {
  it("updates Consent Mode and pushes consent_status", () => {
    window.dataLayer = [];
    applyConsentMode({
      necessary: true,
      analytics: true,
      marketing: false,
    });

    expect(window.dataLayer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "consent_status",
          consent_analytics: "granted",
          consent_marketing: "denied",
        }),
      ]),
    );
  });

  it("announces the choice to in-app listeners", () => {
    const listener = vi.fn();
    window.addEventListener(CONSENT_CHANGE_EVENT, listener);
    const choice = {
      necessary: true,
      analytics: false,
      marketing: true,
    } as const;

    applyConsentMode(choice);

    window.removeEventListener(CONSENT_CHANGE_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual(choice);
  });
});

function toPlainDataLayer(): unknown[] {
  return (window.dataLayer ?? []).map((entry) =>
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    "length" in entry
      ? Array.from(entry as ArrayLike<unknown>)
      : entry,
  );
}

describe("ensureConsentModeDefault", () => {
  beforeEach(() => {
    window.dataLayer = undefined;
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  });

  afterEach(() => {
    window.dataLayer = undefined;
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  });

  it("queues denied defaults and privacy flags when missing", () => {
    expect(hasConsentModeDefault()).toBe(false);
    expect(ensureConsentModeDefault()).toBe(true);
    expect(hasConsentModeDefault()).toBe(true);
    expect(toPlainDataLayer()).toEqual([
      ["consent", "default", CONSENT_MODE_DEFAULTS],
      ["set", "url_passthrough", true],
      ["set", "ads_data_redaction", true],
    ]);
  });

  it("replays a stored cookie choice after the denied default", () => {
    setLocation("localhost", "http:");
    writeConsent({ analytics: true, marketing: true });

    expect(ensureConsentModeDefault()).toBe(true);
    expect(toPlainDataLayer()).toEqual([
      ["consent", "default", CONSENT_MODE_DEFAULTS],
      [
        "consent",
        "update",
        {
          analytics_storage: "granted",
          ad_storage: "granted",
          ad_user_data: "granted",
          ad_personalization: "granted",
        },
      ],
      {
        event: "consent_status",
        consent_analytics: "granted",
        consent_marketing: "granted",
      },
      ["set", "url_passthrough", true],
      ["set", "ads_data_redaction", true],
    ]);
  });

  it("is a no-op when consent default was already queued", () => {
    expect(ensureConsentModeDefault()).toBe(true);
    const lengthAfterFirst = window.dataLayer?.length;

    expect(ensureConsentModeDefault()).toBe(false);
    expect(window.dataLayer).toHaveLength(lengthAfterFirst ?? 0);
  });

  it("still queues the default when only a consent update was pushed earlier", () => {
    applyConsentMode({
      necessary: true,
      analytics: false,
      marketing: false,
    });
    expect(hasConsentModeDefault()).toBe(false);

    expect(ensureConsentModeDefault()).toBe(true);
    expect(hasConsentModeDefault()).toBe(true);
  });
});

describe("blocked-route Google telemetry helpers", () => {
  beforeEach(() => {
    window.dataLayer = undefined;
    Reflect.deleteProperty(window, "ga-disable-G-TEST");
    Reflect.deleteProperty(window, "google_tag_manager");
    document.getElementById("_next-ga")?.remove();
    document.getElementById("_next-gtm")?.remove();
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  });

  afterEach(() => {
    window.dataLayer = undefined;
    Reflect.deleteProperty(window, "ga-disable-G-TEST");
    Reflect.deleteProperty(window, "google_tag_manager");
    document.getElementById("_next-ga")?.remove();
    document.getElementById("_next-gtm")?.remove();
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  });

  it("detects whether Google tags have loaded in the current document", () => {
    expect(hasLoadedGoogleTags()).toBe(false);

    const script = document.createElement("script");
    script.id = "_next-ga";
    document.head.appendChild(script);
    expect(hasLoadedGoogleTags()).toBe(true);
  });

  it("toggles window['ga-disable-<gaId>'] only when gaId is set", () => {
    setGoogleAnalyticsDisabled(undefined, true);
    expect(Reflect.get(window, "ga-disable-undefined")).toBeUndefined();

    setGoogleAnalyticsDisabled("G-TEST", true);
    expect(Reflect.get(window, "ga-disable-G-TEST")).toBe(true);

    setGoogleAnalyticsDisabled("G-TEST", false);
    expect(Reflect.get(window, "ga-disable-G-TEST")).toBe(false);
  });

  it("denies consent and restores the persisted cookie choice", () => {
    setLocation("localhost", "http:");
    writeConsent({ analytics: true, marketing: false });

    denyConsentMode();
    restorePersistedConsentMode();

    expect(toPlainDataLayer()).toEqual([
      [
        "consent",
        "update",
        {
          analytics_storage: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
      [
        "consent",
        "update",
        {
          analytics_storage: "granted",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
    ]);
  });
});
