import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOVER_DWELL_MS,
  RestingIntentLink,
} from "@/components/resting-intent-link";
import { UNSETTLED_MS } from "@/hooks/use-intent-prefetch";
import { approachElement } from "@/test/approach-element";

const routerPrefetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: routerPrefetchMock }),
}));

function renderTasksLink() {
  render(
    <RestingIntentLink href="/tasks" prefetchContent>
      Tasks
    </RestingIntentLink>,
  );
  return screen.getByRole("link", { name: "Tasks" });
}

describe("RestingIntentLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The link keeps its own ref for the predicted approach. A caller's ref,
  // such as a Radix Slot's, must still reach the anchor.
  it("passes the anchor to the caller's ref", () => {
    const ref = createRef<HTMLAnchorElement>();

    const { unmount } = render(
      <RestingIntentLink href="/tasks" ref={ref}>
        Tasks
      </RestingIntentLink>,
    );

    expect(ref.current).toBe(screen.getByRole("link", { name: "Tasks" }));
    unmount();
    expect(ref.current).toBeNull();
  });

  // The library keeps the cursor's last point after it leaves the page, so a
  // list that shifts under that point reports a hover nobody made.
  it("loads only the shell for a hover hit while the cursor is off the page", async () => {
    const link = renderTasksLink();

    await act(() => approachElement(link, "mouse", "off-page"));

    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith("/tasks");
  });

  // A scroll moves rows under a still cursor. Each would start a server
  // render once it stayed under the cursor for the short hover dwell. The row
  // the scroll stops on still loads, once the scroll has settled.
  // The clock starts at 0, so the scroll time this module keeps lies far in
  // the past for every later test.
  it("waits for a scroll to settle before the hover dwell loads the content", () => {
    vi.useFakeTimers({ now: 0 });
    try {
      const link = renderTasksLink();

      document.dispatchEvent(new Event("scroll"));
      fireEvent.pointerEnter(link, { pointerType: "mouse" });
      // The scroll goes on while the row stays under the cursor, so the dwell
      // that would fire once the first scroll settles waits again.
      vi.advanceTimersByTime(UNSETTLED_MS - HOVER_DWELL_MS);
      document.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(UNSETTLED_MS);
      expect(routerPrefetchMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(HOVER_DWELL_MS);
      expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith("/tasks", {
        kind: "full",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
