// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCmoAppPoll } from "./use-cmo-app-poll";

describe("useCmoAppPoll", () => {
  let container: HTMLDivElement;
  let root: Root;
  let visibility: DocumentVisibilityState = "visible";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
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
    useCmoAppPoll(refresh);
    return null;
  }

  it("polls every 4s only while visible, refreshes on visibilitychange, rebinds on refresh change, and cleans up on unmount", async () => {
    const firstRefresh = vi.fn(async () => {});
    const secondRefresh = vi.fn(async () => {});

    await act(async () => root.render(<Probe refresh={firstRefresh} />));

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(firstRefresh).toHaveBeenCalledTimes(1);

    visibility = "hidden";
    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });
    expect(firstRefresh).toHaveBeenCalledTimes(1);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(firstRefresh).toHaveBeenCalledTimes(2);

    await act(async () => root.render(<Probe refresh={secondRefresh} />));
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(firstRefresh).toHaveBeenCalledTimes(2);
    expect(secondRefresh).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      vi.advanceTimersByTime(8_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(secondRefresh).toHaveBeenCalledTimes(1);
  });
});
