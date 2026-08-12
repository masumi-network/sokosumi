import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyConsentMode,
  CONSENT_COOKIE,
  CONSENT_VERSION,
  readConsent,
  writeConsent,
} from "../consent";

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
});
