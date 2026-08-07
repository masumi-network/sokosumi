import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScrollArea } from "../scroll-area";

describe("ScrollArea", () => {
  afterEach(() => {
    cleanup();
  });

  it("leaves Radix table sizing alone by default", () => {
    const { container } = render(
      <ScrollArea className="h-40 w-80">
        <div data-testid="scroll-content">content</div>
      </ScrollArea>,
    );

    const root = container.querySelector('[data-slot="scroll-area"]');
    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]',
    );
    expect(root).not.toHaveAttribute("data-scroll-area-shrink-content");
    expect(viewport?.className).not.toContain("*:!block");
    expect(viewport?.className).not.toContain("*:!min-w-0");
  });

  it("opts in to block content sizing for shrinkable flex columns", () => {
    const { container } = render(
      <ScrollArea shrinkContent className="h-40 w-80">
        <div data-testid="scroll-content">content</div>
      </ScrollArea>,
    );

    const root = container.querySelector('[data-slot="scroll-area"]');
    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]',
    );
    expect(root).toHaveAttribute("data-scroll-area-shrink-content");
    // `!` utilities beat Radix's inline `display:table; min-width:100%`
    // (chat video min-content / Chrome ~476px floor).
    expect(viewport?.className).toContain("*:!block");
    expect(viewport?.className).toContain("*:!min-w-0");
    expect(viewport?.className).toContain("*:w-full");
  });
});
