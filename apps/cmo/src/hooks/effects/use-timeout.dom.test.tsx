// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTimeout } from "./use-timeout";

describe("useTimeout (CMO)", () => {
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
    resetKey,
  }: {
    callback: () => void;
    delayMs: number | null;
    resetKey?: unknown;
  }) {
    useTimeout(callback, delayMs, resetKey);
    return null;
  }

  it("fires once, pauses on null, and clears on unmount", async () => {
    const callback = vi.fn();
    await act(async () =>
      root.render(<Probe callback={callback} delayMs={500} />),
    );

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    await act(async () =>
      root.render(<Probe callback={callback} delayMs={null} />),
    );
    await act(async () =>
      root.render(<Probe callback={callback} delayMs={500} />),
    );
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("uses the latest callback and restarts when resetKey changes", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await act(async () =>
      root.render(<Probe callback={first} delayMs={1_000} resetKey="a" />),
    );

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () =>
      root.render(<Probe callback={second} delayMs={1_000} resetKey="a" />),
    );
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    await act(async () =>
      root.render(<Probe callback={second} delayMs={1_000} resetKey="b" />),
    );
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(second).toHaveBeenCalledTimes(2);
  });
});
