import { render } from "@testing-library/react";
import { Activity, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStudioCompareMountLifecycle } from "./use-studio-compare-mount-lifecycle";

function LifecycleProbe({
  active,
  advanceTimer,
}: {
  active: RefObject<boolean>;
  advanceTimer: RefObject<ReturnType<typeof setTimeout> | null>;
}) {
  useStudioCompareMountLifecycle(active, advanceTimer);
  return null;
}

describe("useStudioCompareMountLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks active on mount and clears active and any pending advance timer on unmount", () => {
    const active = { current: false };
    const onAdvance = vi.fn();
    const advanceTimer: RefObject<ReturnType<typeof setTimeout> | null> = {
      current: null,
    };

    const { unmount } = render(
      <LifecycleProbe active={active} advanceTimer={advanceTimer} />,
    );
    expect(active.current).toBe(true);

    advanceTimer.current = setTimeout(() => {
      onAdvance();
    }, 1200);
    unmount();

    expect(active.current).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("resets on Activity hide and restores active on Activity reveal", () => {
    const active = { current: false };
    const onAdvance = vi.fn();
    const advanceTimer: RefObject<ReturnType<typeof setTimeout> | null> = {
      current: null,
    };

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <LifecycleProbe active={active} advanceTimer={advanceTimer} />
      </Activity>,
    );
    expect(active.current).toBe(true);
    advanceTimer.current = setTimeout(() => {
      onAdvance();
    }, 1200);

    rerender(
      <Activity mode="hidden">
        <LifecycleProbe active={active} advanceTimer={advanceTimer} />
      </Activity>,
    );
    expect(active.current).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(onAdvance).not.toHaveBeenCalled();

    rerender(
      <Activity mode="visible">
        <LifecycleProbe active={active} advanceTimer={advanceTimer} />
      </Activity>,
    );
    expect(active.current).toBe(true);

    unmount();
  });
});
