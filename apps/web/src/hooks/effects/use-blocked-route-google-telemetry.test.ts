import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_COOKIE, CONSENT_VERSION } from "@/lib/analytics/consent";

const gaIdRef = { current: "G-TEST" as string | undefined };

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: gaIdRef.current,
  }),
}));

import {
  isTelemetryBlockedPath,
  useBlockedRouteGoogleTelemetry,
} from "./use-blocked-route-google-telemetry";

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

function mountFakeGoogleScript() {
  const script = document.createElement("script");
  script.id = "_next-ga";
  document.head.appendChild(script);
}

describe("isTelemetryBlockedPath", () => {
  it.each([
    "/reset-password",
    "/reset-password/exchange",
    "/n/weekly/embed",
    "/n/weekly/embed/",
  ])("returns true for blocked path %s", (pathname) => {
    expect(isTelemetryBlockedPath(pathname)).toBe(true);
  });

  it.each([
    "/signin",
    "/forgot-password",
    "/n/weekly",
    "/n/weekly/embed/child",
  ])("returns false for allowed path %s", (pathname) => {
    expect(isTelemetryBlockedPath(pathname)).toBe(false);
  });
});

describe("useBlockedRouteGoogleTelemetry", () => {
  beforeEach(() => {
    gaIdRef.current = "G-TEST";
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

  it("does nothing on a fresh blocked route when no Google tags have loaded", () => {
    renderHook(() => useBlockedRouteGoogleTelemetry(true));

    expect(window.dataLayer).toBeUndefined();
    expect(Reflect.get(window, "ga-disable-G-TEST")).toBeUndefined();
  });

  it("sets ga-disable and denies consent before later popstate listeners without stopping propagation, then restores on Forward", () => {
    window.history.replaceState(null, "", "/signin");
    window.dataLayer = [];
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        ts: 1,
        v: CONSENT_VERSION,
      }),
    )}; Path=/`;

    const { unmount } = renderHook(() => useBlockedRouteGoogleTelemetry(false));
    mountFakeGoogleScript();

    const observed: { path: string; disabled: unknown }[] = [];
    const laterGaListener = () => {
      observed.push({
        path: window.location.pathname,
        disabled: Reflect.get(window, "ga-disable-G-TEST"),
      });
    };
    window.addEventListener("popstate", laterGaListener);

    try {
      window.history.replaceState(null, "", "/reset-password");
      window.dispatchEvent(new PopStateEvent("popstate"));

      window.history.replaceState(null, "", "/signin");
      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(observed).toEqual([
        { path: "/reset-password", disabled: true },
        { path: "/signin", disabled: false },
      ]);
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
    } finally {
      window.removeEventListener("popstate", laterGaListener);
      unmount();
    }
  });

  it("re-enables GA without pushing a consent grant when no consent cookie is persisted", () => {
    window.dataLayer = [];
    mountFakeGoogleScript();

    const { rerender } = renderHook(
      ({ isBlocked }: { isBlocked: boolean }) =>
        useBlockedRouteGoogleTelemetry(isBlocked),
      { initialProps: { isBlocked: false } },
    );

    rerender({ isBlocked: true });
    expect(Reflect.get(window, "ga-disable-G-TEST")).toBe(true);
    expect(toPlainDataLayer()).toHaveLength(1);

    rerender({ isBlocked: false });
    expect(Reflect.get(window, "ga-disable-G-TEST")).toBe(false);
    expect(toPlainDataLayer()).toHaveLength(1);
  });

  it("still updates Consent Mode when only GTM is configured (gaId unset)", () => {
    gaIdRef.current = undefined;
    window.dataLayer = [];
    const gtmScript = document.createElement("script");
    gtmScript.id = "_next-gtm";
    document.head.appendChild(gtmScript);

    const { rerender } = renderHook(
      ({ isBlocked }: { isBlocked: boolean }) =>
        useBlockedRouteGoogleTelemetry(isBlocked),
      { initialProps: { isBlocked: false } },
    );

    rerender({ isBlocked: true });
    expect(Reflect.get(window, "ga-disable-undefined")).toBeUndefined();
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
    ]);
  });
});
