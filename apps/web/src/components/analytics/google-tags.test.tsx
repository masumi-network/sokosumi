import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const syncInternalTrafficMock = vi.fn();

vi.mock("@next/third-parties/google", () => ({
  GoogleTagManager: ({ gtmId }: { gtmId: string }) => (
    <div data-testid="gtm">{gtmId}</div>
  ),
  GoogleAnalytics: ({ gaId }: { gaId: string }) => (
    <div data-testid="ga">{gaId}</div>
  ),
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
});
