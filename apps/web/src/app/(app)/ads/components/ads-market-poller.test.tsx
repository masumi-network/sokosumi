import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdsMarketPoller } from "./ads-market-poller";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("AdsMarketPoller", () => {
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
    render(<AdsMarketPoller />);

    advance(19_999);
    expect(refreshMock).not.toHaveBeenCalled();

    advance(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    advance(40_000);
    expect(refreshMock).toHaveBeenCalledTimes(3);
  });

  it("stops when unmounted", () => {
    const { unmount } = render(<AdsMarketPoller />);

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
    render(<AdsMarketPoller />);

    advance(20_000);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    advance(60_000);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    advance(20_000);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("skips ticks while the tab is hidden", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    render(<AdsMarketPoller />);

    advance(60_000);
    expect(refreshMock).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    advance(20_000);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
