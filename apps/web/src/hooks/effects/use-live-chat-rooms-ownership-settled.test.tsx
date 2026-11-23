import { act, render, screen } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIDEBAR_REGISTRATION_WAIT_MS,
  useLiveChatRoomsOwnershipSettled,
} from "./use-live-chat-rooms-ownership-settled";
import { MOBILE_BREAKPOINT } from "./use-mobile";

function OwnershipProbe() {
  const settled = useLiveChatRoomsOwnershipSettled();
  return <span data-testid="settled">{settled ? "yes" : "no"}</span>;
}

describe("useLiveChatRoomsOwnershipSettled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("settles immediately on mobile viewports and waits SIDEBAR_REGISTRATION_WAIT_MS on desktop", () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    const mobile = render(<OwnershipProbe />);
    expect(screen.getByTestId("settled")).toHaveTextContent("yes");
    mobile.unmount();

    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT);
    const desktop = render(<OwnershipProbe />);
    expect(screen.getByTestId("settled")).toHaveTextContent("no");

    act(() => {
      vi.advanceTimersByTime(SIDEBAR_REGISTRATION_WAIT_MS - 1);
    });
    expect(screen.getByTestId("settled")).toHaveTextContent("no");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("settled")).toHaveTextContent("yes");
    desktop.unmount();
  });

  it("re-samples window.innerWidth on React Activity reveal and cleans up timers on StrictMode replay and unmount", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT + 200);

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <OwnershipProbe />
        </Activity>
      </StrictMode>,
    );
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("settled")).toHaveTextContent("no");

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <OwnershipProbe />
        </Activity>
      </StrictMode>,
    );
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);

    // Viewport narrows to mobile while hidden: reveal settles immediately without a 2s wait.
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 100);
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <OwnershipProbe />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByTestId("settled")).toHaveTextContent("yes");

    unmount();
  });
});
