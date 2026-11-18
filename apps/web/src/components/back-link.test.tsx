import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackLink } from "./back-link";

const routerPrefetchMock = vi.fn();
const routerBackMock = vi.fn();
const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn();
// Next's router is one stable object, so the mock is too.
const router = {
  prefetch: routerPrefetchMock,
  back: routerBackMock,
  replace: routerReplaceMock,
  push: routerPushMock,
};

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const FULL = expect.objectContaining({ kind: "full" });

// happy-dom does no layout: a link counts as rendered unless an ancestor has
// `display: none` inline.
function stubLayout() {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element,
  ) {
    const hidden = this.closest("[style*='display: none']") !== null;
    return (hidden
      ? []
      : [new DOMRect(0, 0, 10, 10)]) as unknown as DOMRectList;
  });
}

describe("BackLink", () => {
  beforeEach(() => {
    routerPrefetchMock.mockReset();
    routerBackMock.mockReset();
    routerReplaceMock.mockReset();
    routerPushMock.mockReset();
    stubLayout();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("a click", () => {
    /** Navigation API history whose last entry is the current page. */
    function stubHistory(...paths: string[]) {
      const entries = paths.map((path, index) => ({
        key: `k${index}`,
        url: `${window.location.origin}${path}`,
        sameDocument: true,
      }));
      vi.stubGlobal("navigation", {
        currentEntry: entries.at(-1),
        entries: () => entries,
      });
    }

    it("pops back to the parent the reader came from", () => {
      stubHistory("/chat", "/chat/rooms/r1");
      render(<BackLink href="/chat">Back</BackLink>);

      fireEvent.click(screen.getByRole("link", { name: "Back" }));

      expect(routerBackMock).toHaveBeenCalledOnce();
      expect(routerPushMock).not.toHaveBeenCalled();
    });

    it("swaps the page for the parent when the reader came from elsewhere", () => {
      stubHistory("/", "/chat/rooms/r1");
      render(<BackLink href="/chat">Back</BackLink>);

      fireEvent.click(screen.getByRole("link", { name: "Back" }));

      expect(routerReplaceMock).toHaveBeenCalledWith("/chat");
      expect(routerBackMock).not.toHaveBeenCalled();
      expect(routerPushMock).not.toHaveBeenCalled();
    });

    it("leaves a modified click to open the parent in a new tab", () => {
      stubHistory("/chat", "/chat/rooms/r1");
      render(<BackLink href="/chat">Back</BackLink>);

      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      });
      screen.getByRole("link", { name: "Back" }).dispatchEvent(event);

      expect(routerBackMock).not.toHaveBeenCalled();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });

    it("lets the caller's own click handler take over", () => {
      stubHistory("/chat", "/chat/rooms/r1");
      render(
        <BackLink href="/chat" onClick={(event) => event.preventDefault()}>
          Back
        </BackLink>,
      );

      fireEvent.click(screen.getByRole("link", { name: "Back" }));

      expect(routerBackMock).not.toHaveBeenCalled();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });
  });

  it("loads a content parent's page with its query once it shows", () => {
    render(<BackLink href="/tasks?view=list">Back</BackLink>);

    expect(routerPrefetchMock.mock.calls).toEqual([["/tasks?view=list", FULL]]);
  });

  it("loads nothing up front for a parent without private-cached reads", () => {
    render(<BackLink href="/drive?view=workspace">Back</BackLink>);

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  it("loads nothing for a link the other breakpoint hides", () => {
    render(
      <div style={{ display: "none" }}>
        <BackLink href="/">Back</BackLink>
      </div>,
    );

    expect(routerPrefetchMock).not.toHaveBeenCalled();
  });

  it("waits for the real path, then loads each new target once", () => {
    const { rerender } = render(
      <BackLink href="/tasks" prefetchOnMount={false}>
        Back
      </BackLink>,
    );
    rerender(<BackLink href="/tasks?view=list">Back</BackLink>);
    rerender(<BackLink href="/tasks?view=list">Back</BackLink>);
    rerender(<BackLink href="/tasks?view=board&assignee=me">Back</BackLink>);

    expect(routerPrefetchMock.mock.calls).toEqual([
      ["/tasks?view=list", FULL],
      ["/tasks?view=board&assignee=me", FULL],
    ]);
  });

  describe("after a refresh drops the loaded parent", () => {
    function dropLoad(call: number) {
      const [, options] = routerPrefetchMock.mock.calls[call];
      (options.onInvalidate as () => void)();
    }

    // The detail page refreshes itself right after a navigation, which drops
    // the parent this link loaded as it showed.
    it("loads it again while the link shows it", () => {
      render(<BackLink href="/tasks?view=list">Back</BackLink>);

      dropLoad(0);

      expect(routerPrefetchMock.mock.calls).toEqual([
        ["/tasks?view=list", FULL],
        ["/tasks?view=list", FULL],
      ]);
    });

    it("does not load it again once the link is gone", () => {
      const { unmount } = render(<BackLink href="/tasks">Back</BackLink>);

      unmount();
      dropLoad(0);

      expect(routerPrefetchMock).toHaveBeenCalledOnce();
    });

    // A resize can hand back to the other breakpoint's link.
    it("does not load it again once the link is hidden", () => {
      render(
        <div data-testid="breakpoint">
          <BackLink href="/tasks">Back</BackLink>
        </div>,
      );

      screen.getByTestId("breakpoint").style.display = "none";
      dropLoad(0);

      expect(routerPrefetchMock).toHaveBeenCalledOnce();
    });

    it("does not load the old target again after the href changes", () => {
      const { rerender } = render(<BackLink href="/tasks">Back</BackLink>);
      rerender(<BackLink href="/tasks?view=list">Back</BackLink>);

      dropLoad(0);

      expect(routerPrefetchMock.mock.calls).toEqual([
        ["/tasks", FULL],
        ["/tasks?view=list", FULL],
      ]);
    });
  });
});
