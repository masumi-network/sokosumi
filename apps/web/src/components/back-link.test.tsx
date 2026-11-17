import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackLink } from "./back-link";

const routerPrefetchMock = vi.fn();
// Next's router is one stable object, so the mock is too.
const router = { prefetch: routerPrefetchMock };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const FULL = { kind: "full" };

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
});
