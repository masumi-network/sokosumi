import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_COOKIE, CONSENT_VERSION } from "@/lib/analytics/consent";

const usePathnameMock = vi.fn();
const gaIdRef = { current: "G-TEST" as string | undefined };

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: gaIdRef.current,
  }),
}));

import { TelemetryBoundary } from "./telemetry-boundary";

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
  return script;
}

function ResetFormFixture() {
  const [password, setPassword] = useState("");
  return (
    <input
      aria-label="New password"
      value={password}
      onChange={(event) => setPassword(event.target.value)}
    />
  );
}

describe("TelemetryBoundary", () => {
  const reloadMock = vi.fn();

  beforeEach(() => {
    usePathnameMock.mockReset();
    reloadMock.mockReset();
    gaIdRef.current = "G-TEST";
    window.dataLayer = undefined;
    Reflect.deleteProperty(window, "ga-disable-G-TEST");
    Reflect.deleteProperty(window, "google_tag_manager");
    document.getElementById("_next-ga")?.remove();
    document.getElementById("_next-gtm")?.remove();
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
    vi.spyOn(window.location, "reload").mockImplementation(reloadMock);
  });

  afterEach(() => {
    window.dataLayer = undefined;
    Reflect.deleteProperty(window, "ga-disable-G-TEST");
    Reflect.deleteProperty(window, "google_tag_manager");
    document.getElementById("_next-ga")?.remove();
    document.getElementById("_next-gtm")?.remove();
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  });

  it.each([
    "/reset-password",
    "/reset-password/exchange",
    "/n/weekly/embed",
    "/n/weekly/embed/",
  ])(
    "blocks telemetry on a fresh %s load without touching dataLayer or ga-disable",
    (pathname) => {
      usePathnameMock.mockReturnValue(pathname);

      render(
        <TelemetryBoundary>
          <span>telemetry</span>
        </TelemetryBoundary>,
      );

      expect(screen.queryByText("telemetry")).not.toBeInTheDocument();
      expect(window.dataLayer).toBeUndefined();
      expect(Reflect.get(window, "ga-disable-G-TEST")).toBeUndefined();
      expect(reloadMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/signin",
    "/n/weekly",
    "/n/weekly/archive",
    "/n/weekly/embedded",
    "/n/weekly/embed/child",
  ])("allows telemetry on %s", (pathname) => {
    usePathnameMock.mockReturnValue(pathname);

    render(
      <TelemetryBoundary>
        <span>telemetry</span>
      </TelemetryBoundary>,
    );

    expect(screen.getByText("telemetry")).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("disables GA and denies consent before a history-change listener runs on Back to /reset-password, without reloading or wiping form state", async () => {
    const user = userEvent.setup();
    usePathnameMock.mockReturnValue("/signin");
    window.history.replaceState(null, "", "/signin");
    window.dataLayer = [];
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: true,
        ts: 1,
        v: CONSENT_VERSION,
      }),
    )}; Path=/`;

    const { rerender } = render(
      <>
        <TelemetryBoundary>
          <span>telemetry</span>
        </TelemetryBoundary>
        <ResetFormFixture />
      </>,
    );

    await user.type(screen.getByLabelText("New password"), "DraftPass123!");
    mountFakeGoogleScript();

    // Simulate GA4's history-change listener registered after gtag/js loads.
    const gaHits: string[] = [];
    const seenAtGaHistoryChange: {
      disabled: unknown;
      dataLayer: unknown[];
    }[] = [];
    const simulatedGaPopState = () => {
      const disabled = Reflect.get(window, "ga-disable-G-TEST");
      seenAtGaHistoryChange.push({
        disabled,
        dataLayer: toPlainDataLayer(),
      });
      if (!disabled) {
        gaHits.push(window.location.pathname);
      }
    };
    window.addEventListener("popstate", simulatedGaPopState);

    try {
      window.history.replaceState(null, "", "/reset-password");
      window.dispatchEvent(new PopStateEvent("popstate"));

      usePathnameMock.mockReturnValue("/reset-password");
      rerender(
        <>
          <TelemetryBoundary>
            <span>telemetry</span>
          </TelemetryBoundary>
          <ResetFormFixture />
        </>,
      );

      expect(gaHits).toEqual([]);
      expect(seenAtGaHistoryChange).toEqual([
        {
          disabled: true,
          dataLayer: [
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
          ],
        },
      ]);
      expect(reloadMock).not.toHaveBeenCalled();
      expect(screen.queryByText("telemetry")).not.toBeInTheDocument();
      expect(screen.getByLabelText("New password")).toHaveValue(
        "DraftPass123!",
      );

      // Leaving /reset-password restores persisted consent and re-enables GA.
      window.history.replaceState(null, "", "/signin");
      usePathnameMock.mockReturnValue("/signin");
      rerender(
        <>
          <TelemetryBoundary>
            <span>telemetry</span>
          </TelemetryBoundary>
          <ResetFormFixture />
        </>,
      );

      expect(Reflect.get(window, "ga-disable-G-TEST")).toBe(false);
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
            ad_storage: "granted",
            ad_user_data: "granted",
            ad_personalization: "granted",
          },
        ],
      ]);
    } finally {
      window.removeEventListener("popstate", simulatedGaPopState);
    }
  });

  it("pushes a single deny/restore update even with two TelemetryBoundary instances mounted", () => {
    usePathnameMock.mockReturnValue("/signin");
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
    mountFakeGoogleScript();

    const { rerender } = render(
      <>
        <TelemetryBoundary>
          <span>google-tags</span>
        </TelemetryBoundary>
        <TelemetryBoundary>
          <span>client-analytics</span>
        </TelemetryBoundary>
      </>,
    );

    usePathnameMock.mockReturnValue("/reset-password");
    rerender(
      <>
        <TelemetryBoundary>
          <span>google-tags</span>
        </TelemetryBoundary>
        <TelemetryBoundary>
          <span>client-analytics</span>
        </TelemetryBoundary>
      </>,
    );

    expect(Reflect.get(window, "ga-disable-G-TEST")).toBe(true);
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

    usePathnameMock.mockReturnValue("/signin");
    rerender(
      <>
        <TelemetryBoundary>
          <span>google-tags</span>
        </TelemetryBoundary>
        <TelemetryBoundary>
          <span>client-analytics</span>
        </TelemetryBoundary>
      </>,
    );

    expect(Reflect.get(window, "ga-disable-G-TEST")).toBe(false);
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
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
