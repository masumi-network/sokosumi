// @vitest-environment happy-dom

import type { CmoAdCampaigns } from "@sokosumi/core-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAdCampaigns } from "./use-ad-campaigns";

type AdAccounts = CmoAdCampaigns["accounts"];

describe("useAdCampaigns", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function Probe({
    connected,
    loadAdCampaigns,
  }: {
    connected: boolean;
    loadAdCampaigns: (range: "LAST_7_DAYS") => Promise<AdAccounts>;
  }) {
    const [accounts] = useAdCampaigns(connected, loadAdCampaigns);
    return <span data-count={accounts === null ? "null" : accounts.length} />;
  }

  it("loads when connected, falls back to empty array on error, and ignores late resolutions after unmount", async () => {
    const deferred = Promise.withResolvers<AdAccounts>();
    const loadAdCampaigns = vi.fn(() => deferred.promise);

    await act(async () =>
      root.render(
        <Probe connected={false} loadAdCampaigns={loadAdCampaigns} />,
      ),
    );
    expect(loadAdCampaigns).not.toHaveBeenCalled();
    expect(container.querySelector("span")?.getAttribute("data-count")).toBe(
      "null",
    );

    await act(async () =>
      root.render(<Probe connected loadAdCampaigns={loadAdCampaigns} />),
    );
    expect(loadAdCampaigns).toHaveBeenCalledWith("LAST_7_DAYS");

    await act(async () => {
      deferred.resolve([{} as AdAccounts[number]]);
      await Promise.resolve();
    });
    expect(container.querySelector("span")?.getAttribute("data-count")).toBe(
      "1",
    );

    const failing = vi.fn(() => Promise.reject(new Error("boom")));
    await act(async () =>
      root.render(<Probe connected loadAdCampaigns={failing} />),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("span")?.getAttribute("data-count")).toBe(
      "0",
    );
  });
});
