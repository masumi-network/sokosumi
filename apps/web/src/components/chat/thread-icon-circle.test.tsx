import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThreadIconCircle } from "./thread-icon-circle";

function mark() {
  return screen.getByTestId("thread-icon-circle");
}

describe("ThreadIconCircle", () => {
  it("tints the circle for an attention mark and leaves a read one bare", () => {
    const { rerender } = render(<ThreadIconCircle tone="attention" />);
    expect(mark().className).toContain("bg-primary-quaternary");
    expect(mark().className).toContain("text-primary-variant");

    rerender(<ThreadIconCircle tone="read" />);
    expect(mark().className).not.toContain("bg-primary-quaternary");
    expect(mark().className).toContain("text-muted-foreground");
  });

  it("keeps the sidebar's quiet circle a separate tone", () => {
    render(<ThreadIconCircle tone="quiet" />);
    expect(mark().className).toContain("bg-sidebar-accent");
    expect(mark().className).toContain("text-muted-foreground");
  });

  // The sidebar's tests read `data-mention` off the link, which a swapped icon
  // would still pass, so the glyph itself is checked here.
  it("draws the `@` for a mention and the thread bubble otherwise", () => {
    const { rerender } = render(<ThreadIconCircle tone="attention" />);
    expect(mark().querySelector("svg")).toHaveClass("lucide-message-square");

    rerender(<ThreadIconCircle tone="attention" glyph="mention" />);
    expect(mark().querySelector("svg")).toHaveClass("lucide-at-sign");
    expect(mark().querySelector("svg")).not.toHaveClass(
      "lucide-message-square",
    );
  });

  it("stays out of the accessibility tree, so the row's own text names it", () => {
    render(<ThreadIconCircle tone="attention" />);
    expect(mark()).toHaveAttribute("aria-hidden", "true");
  });

  it("sizes the panel's circle above the sidebar's", () => {
    const { rerender } = render(<ThreadIconCircle tone="attention" />);
    const small = mark().className;
    rerender(<ThreadIconCircle tone="attention" size="md" />);
    expect(mark().className).not.toEqual(small);
    expect(mark().className).toContain("size-6");
  });
});
