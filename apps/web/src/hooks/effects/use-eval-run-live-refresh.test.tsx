import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEvalRunLiveRefresh } from "./use-eval-run-live-refresh";

describe("useEvalRunLiveRefresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the router every 15 seconds, rebinds on router change, and clears on unmount", () => {
    vi.useFakeTimers();
    const routerA = { refresh: vi.fn() };
    const routerB = { refresh: vi.fn() };

    function Probe({ router }: { router: { refresh: () => void } }) {
      useEvalRunLiveRefresh(router);
      return null;
    }

    const { rerender, unmount } = render(<Probe router={routerA} />);
    vi.advanceTimersByTime(15_000);
    expect(routerA.refresh).toHaveBeenCalledTimes(1);

    rerender(<Probe router={routerB} />);
    vi.advanceTimersByTime(15_000);
    expect(routerA.refresh).toHaveBeenCalledTimes(1);
    expect(routerB.refresh).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(30_000);
    expect(routerB.refresh).toHaveBeenCalledTimes(1);
  });
});
