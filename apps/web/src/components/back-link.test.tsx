import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackLink } from "./back-link";

const routerPrefetchMock = vi.fn();
// Next's router is one stable object, so the mock is too.
const router = { prefetch: routerPrefetchMock };

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
    stubLayout();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
