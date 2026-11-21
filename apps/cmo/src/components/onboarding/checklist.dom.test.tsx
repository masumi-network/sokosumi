// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useElapsed } from "./checklist";

describe("useElapsed", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:05Z"));
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
    since,
    running,
  }: {
    since: Date | string | undefined;
    running: boolean;
  }) {
    const label = useElapsed(since, running);
    return <span>{label ?? "none"}</span>;
  }

  it("ticks every second while running, pauses when stopped, and clears on unmount", async () => {
    const since = new Date("2026-11-20T12:00:00Z");

    await act(async () => root.render(<Probe since={since} running />));
    expect(container.textContent).toBe("5s so far");

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(container.textContent).toBe("8s so far");

    await act(async () => root.render(<Probe since={since} running={false} />));
    expect(container.textContent).toBe("none");
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => root.render(<Probe since={since} running />));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await act(async () => root.unmount());
    root = createRoot(container);
    expect(vi.getTimerCount()).toBe(0);
  });
});
