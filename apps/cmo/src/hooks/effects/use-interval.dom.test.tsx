// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterval } from "./use-interval";

describe("useInterval (CMO)", () => {
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

  function Probe({
    callback,
    delayMs,
  }: {
    callback: () => void;
    delayMs: number | null;
  }) {
    useInterval(callback, delayMs);
    return null;
  }

  it("ticks repeatedly, pauses on null, and clears on unmount", async () => {
    const callback = vi.fn();
    await act(async () =>
      root.render(<Probe callback={callback} delayMs={1_000} />),
    );

    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    expect(callback).toHaveBeenCalledTimes(2);

    await act(async () =>
      root.render(<Probe callback={callback} delayMs={null} />),
    );
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(callback).toHaveBeenCalledTimes(2);

    await act(async () =>
      root.render(<Probe callback={callback} delayMs={500} />),
    );
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without resetting the interval", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await act(async () =>
      root.render(<Probe callback={first} delayMs={1_000} />),
    );

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    await act(async () =>
      root.render(<Probe callback={second} delayMs={1_000} />),
    );

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
