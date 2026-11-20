import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONSENT_COOKIE, readConsent } from "@/lib/analytics/consent";
import {
  openCookieConsentPreferences,
  useCookieConsentBanner,
} from "./use-cookie-consent-banner";

function clearConsentCookie() {
  document.cookie = `${CONSENT_COOKIE}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`;
}

describe("useCookieConsentBanner", () => {
  beforeEach(() => {
    clearConsentCookie();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    clearConsentCookie();
    window.history.replaceState(null, "", "/");
  });

  it("opens when no consent cookie is stored, writes choice via decide, and reopens on event", () => {
    const { result, unmount } = renderHook(() => useCookieConsentBanner());

    expect(result.current.visible).toBe(true);
    expect(result.current.expanded).toBe(false);
    expect(result.current.product).toBe("Sokosumi");

    act(() => {
      result.current.decide({ analytics: true, marketing: false });
    });

    expect(result.current.visible).toBe(false);
    expect(readConsent()).toMatchObject({ analytics: true, marketing: false });

    act(() => {
      openCookieConsentPreferences();
    });

    expect(result.current.visible).toBe(true);
    expect(result.current.expanded).toBe(true);
    expect(result.current.analytics).toBe(true);
    expect(result.current.marketing).toBe(false);

    unmount();
  });

  it("detects OAuth brand from window.location.search on mount", () => {
    window.history.replaceState(
      null,
      "",
      `/signup?client_id=cmo&redirect_uri=${encodeURIComponent(
        "https://app.cmo.xyz/api/auth/callback/sokosumi",
      )}&exp=1&sig=abc`,
    );

    const { result } = renderHook(() => useCookieConsentBanner());
    expect(result.current.product).toBe("CMO.XYZ");
  });
});
