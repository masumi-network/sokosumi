import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScrollArea } from "../scroll-area";

describe("ScrollArea", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks the viewport so Radix inline display:table can be overridden", () => {
    const { container } = render(
      <ScrollArea className="h-40 w-80">
        <div data-testid="scroll-content">content</div>
      </ScrollArea>,
    );

    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]',
    );
    expect(viewport).not.toBeNull();
    // `!` utilities beat Radix's inline `display:table; min-width:100%` once
    // Tailwind CSS is loaded (see chat video min-content / Chrome ~476px floor).
    expect(viewport?.className).toContain("*:!block");
    expect(viewport?.className).toContain("*:!min-w-0");
    expect(viewport?.className).toContain("*:w-full");
  });
});
