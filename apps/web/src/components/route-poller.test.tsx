import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoutePoller } from "./route-poller";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("RoutePoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("refreshes the route every 20 seconds", () => {
    render(<RoutePoller everyMs={20_000} />);

    advance(19_999);
    expect(refreshMock).not.toHaveBeenCalled();

    advance(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    advance(40_000);
    expect(refreshMock).toHaveBeenCalledTimes(3);
  });

  it("stops when unmounted", () => {
    const { unmount } = render(<RoutePoller everyMs={20_000} />);

    unmount();
    advance(60_000);

    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("waits for a refresh in flight before asking again", async () => {
    let finish = () => {};
    refreshMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<RoutePoller everyMs={20_000} />);

    advance(20_000);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    advance(60_000);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    advance(20_000);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("stops asking after `times` refreshes", () => {
    render(<RoutePoller everyMs={20_000} times={2} />);

    advance(200_000);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("skips ticks while the tab is hidden", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    render(<RoutePoller everyMs={20_000} />);

    advance(60_000);
    expect(refreshMock).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    advance(20_000);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
