import { render } from "@testing-library/react";
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
  });

  it("refreshes the route every 20 seconds", () => {
    render(<AdsMarketPoller />);

    vi.advanceTimersByTime(19_999);
    expect(refreshMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(40_000);
    expect(refreshMock).toHaveBeenCalledTimes(3);
  });

  it("stops when unmounted", () => {
    const { unmount } = render(<AdsMarketPoller />);

    unmount();
    vi.advanceTimersByTime(60_000);

    expect(refreshMock).not.toHaveBeenCalled();
  });
});
