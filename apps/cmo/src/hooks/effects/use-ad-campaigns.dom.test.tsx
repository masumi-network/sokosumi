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
    onRender,
  }: {
    connected: boolean;
    loadAdCampaigns: (range: "LAST_7_DAYS") => Promise<AdAccounts>;
    onRender?: (accounts: AdAccounts | null) => void;
  }) {
    const [accounts] = useAdCampaigns(connected, loadAdCampaigns);
    onRender?.(accounts);
    return <span data-count={accounts === null ? "null" : accounts.length} />;
  }

  it("loads when connected and falls back to an empty array on error", async () => {
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

  it("ignores a late resolution or rejection after unmount or cleanup", async () => {
    const first = Promise.withResolvers<AdAccounts>();
    const second = Promise.withResolvers<AdAccounts>();
    const loadFirst = vi.fn(() => first.promise);
    const loadSecond = vi.fn(() => second.promise);
    const onRender = vi.fn<(accounts: AdAccounts | null) => void>();

    await act(async () =>
      root.render(
        <Probe connected loadAdCampaigns={loadFirst} onRender={onRender} />,
      ),
    );

    // Replace loader before first settles: first's late resolution must not win.
    await act(async () =>
      root.render(
        <Probe connected loadAdCampaigns={loadSecond} onRender={onRender} />,
      ),
    );
    await act(async () => {
      first.resolve([{} as AdAccounts[number], {} as AdAccounts[number]]);
      await Promise.resolve();
    });
    expect(container.querySelector("span")?.getAttribute("data-count")).toBe(
      "null",
    );

    // Unmount before second settles: late resolution must be ignored.
    const rendersBeforeUnmount = onRender.mock.calls.length;
    await act(async () => root.unmount());
    root = createRoot(container);

    await act(async () => {
      second.resolve([{} as AdAccounts[number]]);
      await Promise.resolve();
    });
    expect(onRender).toHaveBeenCalledTimes(rendersBeforeUnmount);
  });
});
