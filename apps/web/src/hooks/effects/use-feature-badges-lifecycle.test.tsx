import { render } from "@testing-library/react";
import { Activity, type RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFeatureBadgesLifecycle } from "./use-feature-badges-lifecycle";

function LifecycleProbe({
  mounted,
  exitTimers,
}: {
  mounted: RefObject<boolean>;
  exitTimers: RefObject<Map<string, number[]>>;
}) {
  useFeatureBadgesLifecycle(mounted, exitTimers);
  return null;
}

describe("useFeatureBadgesLifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks mounted state and clears pending pill exit timers on hide and unmount", () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const mounted = { current: false };
    const exitTimers = { current: new Map<string, number[]>() };

    const { rerender, unmount } = render(
      <Activity mode="visible">
        <LifecycleProbe mounted={mounted} exitTimers={exitTimers} />
      </Activity>,
    );

    expect(mounted.current).toBe(true);
    exitTimers.current.set("camp-1", [
      window.setTimeout(fired, 1500),
      window.setTimeout(fired, 1700),
    ]);

    rerender(
      <Activity mode="hidden">
        <LifecycleProbe mounted={mounted} exitTimers={exitTimers} />
      </Activity>,
    );
    expect(mounted.current).toBe(false);
    expect(exitTimers.current.size).toBe(0);

    vi.advanceTimersByTime(2000);
    expect(fired).not.toHaveBeenCalled();

    rerender(
      <Activity mode="visible">
        <LifecycleProbe mounted={mounted} exitTimers={exitTimers} />
      </Activity>,
    );
    expect(mounted.current).toBe(true);
    exitTimers.current.set("camp-2", [window.setTimeout(fired, 1500)]);

    unmount();
    expect(mounted.current).toBe(false);
    expect(exitTimers.current.size).toBe(0);

    vi.advanceTimersByTime(2000);
    expect(fired).not.toHaveBeenCalled();
  });
});
