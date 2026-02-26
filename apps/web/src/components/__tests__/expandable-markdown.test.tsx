import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { ExpandableMarkdown } from "@/components/expandable-markdown";

jest.mock("@/components/markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-mock">{children}</div>
  ),
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  global.ResizeObserver =
    ResizeObserverMock as unknown as typeof global.ResizeObserver;

  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return 200;
    },
  });

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 100;
    },
  });
});

describe("ExpandableMarkdown", () => {
  it("shows the expand control when collapsed content overflows", () => {
    render(
      <ExpandableMarkdown
        content={"```ts\nconst value = 1;\n```"}
        expandLabel="Expand"
        collapseLabel="Collapse"
      />,
    );

    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  });

  it("applies default collapsed max-height based on line clamp", () => {
    const { container } = render(
      <ExpandableMarkdown
        content={"Some markdown content"}
        expandLabel="Expand"
        collapseLabel="Collapse"
      />,
    );

    const collapsedContainer = container.querySelector(".line-clamp-5");

    expect(collapsedContainer).toHaveStyle({ maxHeight: "5lh" });
  });

  it("applies custom collapsed max-height when lineClamp is provided", () => {
    const { container } = render(
      <ExpandableMarkdown
        content={"Some markdown content"}
        lineClamp={3}
        expandLabel="Expand"
        collapseLabel="Collapse"
      />,
    );

    const collapsedContainer = container.querySelector(".line-clamp-3");

    expect(collapsedContainer).toHaveStyle({ maxHeight: "3lh" });
  });
});
