// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSeoPageRefresh } from "./use-seo-page-refresh";

describe("useSeoPageRefresh", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function Probe({ refresh }: { refresh: () => Promise<void> | void }) {
    useSeoPageRefresh(refresh);
    return null;
  }

  it("refreshes immediately on mount, polls every 20s with setup-bound refresh, rebinds on change, and stops on unmount", async () => {
    const firstRefresh = vi.fn(async () => {});
    const secondRefresh = vi.fn(async () => {});

    await act(async () => root.render(<Probe refresh={firstRefresh} />));
    expect(firstRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(firstRefresh).toHaveBeenCalledTimes(2);

    await act(async () => root.render(<Probe refresh={secondRefresh} />));
    expect(secondRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(firstRefresh).toHaveBeenCalledTimes(2);
    expect(secondRefresh).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      vi.advanceTimersByTime(40_000);
    });
    expect(secondRefresh).toHaveBeenCalledTimes(2);
  });
});
