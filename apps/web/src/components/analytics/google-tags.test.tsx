import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_COOKIE, CONSENT_VERSION } from "@/lib/analytics/consent";

const syncInternalTrafficMock = vi.fn();
const dataLayerSnapshotsAtMount: {
  tag: "gtm" | "ga";
  entries: unknown[];
}[] = [];

function snapshotDataLayer(): unknown[] {
  return (window.dataLayer ?? []).map((entry) =>
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    "length" in entry
      ? Array.from(entry as ArrayLike<unknown>)
      : entry,
  );
}

vi.mock("@next/third-parties/google", () => ({
  GoogleTagManager: ({ gtmId }: { gtmId: string }) => {
    dataLayerSnapshotsAtMount.push({
      tag: "gtm",
      entries: snapshotDataLayer(),
    });
    return <div data-testid="gtm">{gtmId}</div>;
  },
  GoogleAnalytics: ({ gaId }: { gaId: string }) => {
    dataLayerSnapshotsAtMount.push({
      tag: "ga",
      entries: snapshotDataLayer(),
    });
    return <div data-testid="ga">{gaId}</div>;
  },
}));

vi.mock("@/lib/analytics/internal-traffic", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/analytics/internal-traffic")
  >()),
  syncInternalTraffic: (...args: unknown[]) => syncInternalTrafficMock(...args),
}));

import { GoogleTags } from "./google-tags";

describe("GoogleTags", () => {
  beforeEach(() => {
    syncInternalTrafficMock.mockReset();
    dataLayerSnapshotsAtMount.length = 0;
    window.dataLayer = undefined;
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  });

  afterEach(() => {
    window.dataLayer = undefined;
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  });

  it("loads GTM and GA for regular visitors", () => {
    syncInternalTrafficMock.mockReturnValue(false);

    const view = render(<GoogleTags gtmId="GTM-TEST" gaId="G-TEST" />);

    expect(view.getByTestId("gtm")).toHaveTextContent("GTM-TEST");
    expect(view.getByTestId("ga")).toHaveTextContent("G-TEST");
    expect(syncInternalTrafficMock).toHaveBeenCalledWith(
      window.location.search,
    );
  });

  it("queues denied Consent Mode defaults before mounting GTM/GA when ConsentModeInit did not run", () => {
    syncInternalTrafficMock.mockReturnValue(false);

    render(<GoogleTags gtmId="GTM-TEST" gaId="G-TEST" />);

    expect(dataLayerSnapshotsAtMount).toHaveLength(2);
    for (const snapshot of dataLayerSnapshotsAtMount) {
      expect(snapshot.entries).toEqual([
        [
          "consent",
          "default",
          {
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied",
            analytics_storage: "denied",
            functionality_storage: "granted",
            security_storage: "granted",
            wait_for_update: 500,
          },
        ],
        ["set", "url_passthrough", true],
        ["set", "ads_data_redaction", true],
      ]);
    }
  });

  it("replays a stored consent choice after the denied default when ConsentModeInit did not run", () => {
    syncInternalTrafficMock.mockReturnValue(false);
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        ts: 1,
        v: CONSENT_VERSION,
      }),
    )}; Path=/`;

    render(<GoogleTags gtmId="GTM-TEST" gaId="G-TEST" />);

    expect(dataLayerSnapshotsAtMount[0]?.entries).toEqual([
      [
        "consent",
        "default",
        {
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
          analytics_storage: "denied",
          functionality_storage: "granted",
          security_storage: "granted",
          wait_for_update: 500,
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
      {
        event: "consent_status",
        consent_analytics: "granted",
        consent_marketing: "denied",
      },
      ["set", "url_passthrough", true],
      ["set", "ads_data_redaction", true],
    ]);
  });

  it("does not duplicate Consent Mode defaults when ConsentModeInit already ran", () => {
    syncInternalTrafficMock.mockReturnValue(false);
    window.dataLayer = [];
    (function pushDefault(..._args: unknown[]) {
      window.dataLayer?.push(arguments);
    })("consent", "default", { analytics_storage: "denied" });

    render(<GoogleTags gtmId="GTM-TEST" gaId="G-TEST" />);

    expect(window.dataLayer).toHaveLength(1);
  });

  it("removes the internal param from the visible URL", () => {
    syncInternalTrafficMock.mockReturnValue(true);
    window.history.replaceState(null, "", "/billing?internal=1&tab=credits");

    render(<GoogleTags gtmId="GTM-TEST" />);

    expect(window.location.pathname + window.location.search).toBe(
      "/billing?tab=credits",
    );
  });

  it("loads no Google tags for internal traffic", () => {
    syncInternalTrafficMock.mockReturnValue(true);

    const view = render(<GoogleTags gtmId="GTM-TEST" gaId="G-TEST" />);

    expect(view.queryByTestId("gtm")).toBeNull();
    expect(view.queryByTestId("ga")).toBeNull();
  });

  it("cleans the URL even when neither Google ID is configured", () => {
    syncInternalTrafficMock.mockReturnValue(true);
    window.history.replaceState(null, "", "/billing?internal=1&tab=credits");

    const view = render(<GoogleTags />);

    expect(window.location.search).toBe("?tab=credits");
    expect(view.container).toBeEmptyDOMElement();
  });
});
