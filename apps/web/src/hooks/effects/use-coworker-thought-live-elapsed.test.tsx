import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCoworkerThoughtLiveElapsed } from "./use-coworker-thought-live-elapsed";

function ElapsedProbe({ startedAtMs }: { startedAtMs: number }) {
  const elapsed = useCoworkerThoughtLiveElapsed(startedAtMs);
  return <span data-testid="elapsed">{elapsed}</span>;
}

describe("useCoworkerThoughtLiveElapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs to Date.now on mount, ticks every 100ms, and restarts on startedAtMs change", () => {
    const { rerender, unmount } = render(<ElapsedProbe startedAtMs={9_500} />);
    expect(screen.getByTestId("elapsed")).toHaveTextContent("500");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("elapsed")).toHaveTextContent("800");

    rerender(<ElapsedProbe startedAtMs={10_200} />);
    expect(screen.getByTestId("elapsed")).toHaveTextContent("100");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("elapsed")).toHaveTextContent("300");

    unmount();
  });

  it("clears the interval on StrictMode replay, Activity hide, and unmount, and resumes on reveal", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <ElapsedProbe startedAtMs={10_000} />
        </Activity>
      </StrictMode>,
    );
    // StrictMode mounts twice and cleans up the first interval once.
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <ElapsedProbe startedAtMs={10_000} />
        </Activity>
      </StrictMode>,
    );
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ElapsedProbe startedAtMs={10_000} />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByTestId("elapsed")).toHaveTextContent("500");

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(
      setIntervalSpy.mock.calls.length,
    );
  });
});
