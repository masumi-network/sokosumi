import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FOCUS_DWELL_MS,
  HOVER_DWELL_MS,
  RestingIntentLink,
} from "@/components/resting-intent-link";
import { UNSETTLED_MS } from "@/hooks/effects/use-intent-prefetch";
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
      expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith(
        "/tasks",
        expect.objectContaining({ kind: "full" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  describe("after a refresh drops the loaded page", () => {
    /** Hovers until the content loads, then returns the drop callback. */
    function hoverUntilLoaded(link: HTMLElement) {
      fireEvent.pointerEnter(link, { pointerType: "mouse", buttons: 0 });
      vi.advanceTimersByTime(HOVER_DWELL_MS);
      expect(routerPrefetchMock).toHaveBeenCalledOnce();
      const [, options] = routerPrefetchMock.mock.calls[0];
      return options.onInvalidate as () => void;
    }

    // Far past the scroll the settle test leaves in this module's state.
    beforeEach(() => {
      vi.useFakeTimers({ now: 1_000_000 });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    // Each page refreshes itself after a navigation. A pointer that rested on
    // a sidebar row while that page loaded would otherwise click into the
    // skeleton, however long it stays.
    it("loads it again while the pointer still rests on the link", () => {
      const link = renderTasksLink();
      const dropped = hoverUntilLoaded(link);

      dropped();

      expect(routerPrefetchMock).toHaveBeenCalledTimes(2);
      expect(routerPrefetchMock).toHaveBeenLastCalledWith(
        "/tasks",
        expect.objectContaining({ kind: "full" }),
      );
    });

    it("does not load it again once the pointer has left", () => {
      const link = renderTasksLink();
      const dropped = hoverUntilLoaded(link);

      fireEvent.pointerLeave(link, { pointerType: "mouse" });
      dropped();

      expect(routerPrefetchMock).toHaveBeenCalledOnce();
    });

    // The click opens this page, and the page's own refresh drops it.
    it("does not load it again after a press on the link", () => {
      const link = renderTasksLink();
      const dropped = hoverUntilLoaded(link);

      fireEvent.pointerDown(link, { pointerType: "mouse" });
      dropped();

      expect(routerPrefetchMock).toHaveBeenCalledOnce();
    });

    // A middle click opens a new tab; this tab's click is still to come.
    it("loads it again after a middle click on the link", () => {
      const link = renderTasksLink();
      const dropped = hoverUntilLoaded(link);

      fireEvent.pointerDown(link, { pointerType: "mouse", button: 1 });
      dropped();

      expect(routerPrefetchMock).toHaveBeenCalledTimes(2);
    });

    // A cmd-click opens a new tab and still fires a click on the link.
    it("loads it again after a modified click on the link", () => {
      const link = renderTasksLink();
      const dropped = hoverUntilLoaded(link);

      fireEvent.pointerDown(link, { pointerType: "mouse", metaKey: true });
      fireEvent.click(link, { metaKey: true });
      dropped();

      expect(routerPrefetchMock).toHaveBeenCalledTimes(2);
    });

    // A hidden or removed link must not keep rendering its page.
    it("does not load it again after the link unmounts", () => {
      const { unmount } = render(
        <RestingIntentLink href="/tasks" prefetchContent>
          Tasks
        </RestingIntentLink>,
      );
      const dropped = hoverUntilLoaded(
        screen.getByRole("link", { name: "Tasks" }),
      );

      unmount();
      dropped();

      expect(routerPrefetchMock).toHaveBeenCalledOnce();
    });

    it("loads it again while keyboard focus rests on the link, not after blur", () => {
      const link = renderTasksLink();
      act(() => link.focus());
      vi.advanceTimersByTime(FOCUS_DWELL_MS);
      const [, options] = routerPrefetchMock.mock.calls[0];
      const dropped = options.onInvalidate as () => void;

      dropped();
      expect(routerPrefetchMock).toHaveBeenCalledTimes(2);

      act(() => link.blur());
      const [, reloaded] = routerPrefetchMock.mock.calls[1];
      (reloaded.onInvalidate as () => void)();
      expect(routerPrefetchMock).toHaveBeenCalledTimes(2);
    });

    // Back to the page the row leads to: the row stops loading content, and
    // the page's own refresh must not render it a second time.
    it("does not load it again once the link stops loading content", () => {
      const { rerender } = render(
        <RestingIntentLink href="/tasks" prefetchContent>
          Tasks
        </RestingIntentLink>,
      );
      const dropped = hoverUntilLoaded(
        screen.getByRole("link", { name: "Tasks" }),
      );

      rerender(<RestingIntentLink href="/tasks">Tasks</RestingIntentLink>);
      dropped();

      expect(routerPrefetchMock).toHaveBeenCalledOnce();
    });

    it("does not load the old page again after the link's href changes", () => {
      const { rerender } = render(
        <RestingIntentLink href="/projects/p-1" prefetchContent>
          Overview
        </RestingIntentLink>,
      );
      const dropped = hoverUntilLoaded(
        screen.getByRole("link", { name: "Overview" }),
      );

      rerender(
        <RestingIntentLink href="/projects/p-2" prefetchContent>
          Overview
        </RestingIntentLink>,
      );
      dropped();

      expect(routerPrefetchMock).toHaveBeenCalledOnce();
    });
  });

  // A card stretches its title link over itself with a pseudo-element, which
  // is not part of the link's box. The card is what the cursor heads for.
  it("takes a card that marks itself as the link's area for the approach", async () => {
    const { container } = render(
      <article data-intent-area>
        <RestingIntentLink href="/tasks/1" prefetchContent>
          Task
        </RestingIntentLink>
      </article>,
    );
    const card = container.querySelector("article") as HTMLElement;

    expect(await act(() => approachElement(card))).toBe(true);

    expect(routerPrefetchMock).toHaveBeenCalledExactlyOnceWith(
      "/tasks/1",
      expect.objectContaining({ kind: "full" }),
    );
  });
});
