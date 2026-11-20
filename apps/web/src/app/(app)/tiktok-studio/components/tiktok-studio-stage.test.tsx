import { act, render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ElapsedTime } from "./tiktok-studio-stage";

describe("ElapsedTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:10Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders elapsed time immediately on mount, ticks every second, and updates immediately when returning from a hidden Activity", () => {
    const since = new Date("2026-11-20T12:00:00Z");
    const { container, rerender, unmount } = render(
      <Activity mode="visible">
        <ElapsedTime since={since} prefix="Making · " />
      </Activity>,
    );

    expect(container.textContent).toBe("Making · 0:10");

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(container.textContent).toBe("Making · 0:13");

    rerender(
      <Activity mode="hidden">
        <ElapsedTime since={since} prefix="Making · " />
      </Activity>,
    );
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    rerender(
      <Activity mode="visible">
        <ElapsedTime since={since} prefix="Making · " />
      </Activity>,
    );
    // Updates immediately on return without waiting for the next 1s tick.
    expect(container.textContent).toBe("Making · 0:33");

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
