import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
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

  it("renders elapsed time immediately on mount and ticks every second", () => {
    const since = new Date("2026-11-20T12:00:00Z");
    const { container, unmount } = render(
      <StrictMode>
        <ElapsedTime since={since} prefix="Making · " />
      </StrictMode>,
    );

    expect(container.textContent).toBe("Making · 0:10");

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(container.textContent).toBe("Making · 0:13");

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
