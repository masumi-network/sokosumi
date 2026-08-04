import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ExpandableMarkdown } from "@/components/expandable-markdown";

vi.mock("@/components/markdown", () => ({
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

  it("starts expanded with no expand control when defaultOpen is true", () => {
    const { container } = render(
      <ExpandableMarkdown
        content={"Some markdown content"}
        expandLabel="Expand"
        collapseLabel="Collapse"
        defaultOpen
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Expand" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".line-clamp-5")).not.toBeInTheDocument();
  });

  it("shows collapse for overflow content that starts expanded via defaultOpen", async () => {
    const user = userEvent.setup();

    render(
      <ExpandableMarkdown
        content={"Some markdown content that overflows"}
        expandLabel="Expand"
        collapseLabel="Collapse"
        defaultOpen
      />,
    );

    const collapseButton = screen.getByRole("button", { name: "Collapse" });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    await user.click(collapseButton);

    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("toggles the expanded state when the controls are clicked", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <ExpandableMarkdown
        content={"Some markdown content"}
        expandLabel="Expand"
        collapseLabel="Collapse"
      />,
    );

    const expandButton = screen.getByRole("button", { name: "Expand" });
    const collapsibleContent = container.querySelector(
      "[data-slot='collapsible-content']",
    );

    expect(collapsibleContent).toHaveAttribute("id");
    expect(expandButton).toHaveAttribute(
      "aria-controls",
      collapsibleContent?.getAttribute("id"),
    );
    expect(expandButton).toHaveAttribute("aria-expanded", "false");

    await user.click(expandButton);

    const collapseButton = screen.getByRole("button", { name: "Collapse" });

    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    await user.click(collapseButton);

    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
