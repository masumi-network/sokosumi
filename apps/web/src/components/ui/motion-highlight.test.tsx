import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  MotionHighlight,
  MotionHighlightItem,
} from "@/components/ui/motion-highlight";

function GroupedTabs({ active }: { active: "details" | "budget" }) {
  return (
    <MotionHighlight
      controlledItems
      value={active}
      className="bg-background rounded-sm"
    >
      <div role="tablist">
        <MotionHighlightItem value="details">
          <button type="button">Details</button>
        </MotionHighlightItem>
        <MotionHighlightItem value="budget">
          <button type="button">Budget</button>
        </MotionHighlightItem>
      </div>
    </MotionHighlight>
  );
}

function activeItem(container: HTMLElement, value: string): HTMLElement {
  const item = container.querySelector<HTMLElement>(
    `[data-slot="motion-highlight-item-container"][data-value="${value}"]`,
  );
  if (!item) {
    throw new Error(`missing highlight item ${value}`);
  }
  return item;
}

describe("MotionHighlight", () => {
  it("keeps the layout pill on the active grouped tab", () => {
    const { container, rerender } = render(<GroupedTabs active="details" />);

    expect(activeItem(container, "details")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      activeItem(container, "details").querySelector(
        '[data-slot="motion-highlight"]',
      ),
    ).not.toBeNull();

    rerender(<GroupedTabs active="budget" />);

    expect(activeItem(container, "budget")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(activeItem(container, "details")).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(
      activeItem(container, "budget").querySelector(
        '[data-slot="motion-highlight"]',
      ),
    ).not.toBeNull();
  });
});
