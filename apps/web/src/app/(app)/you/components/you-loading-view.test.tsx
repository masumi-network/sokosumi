import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { YouPageSkeleton } from "./you-loading-view";

describe("YouPageSkeleton", () => {
  it("keeps the identity header left-aligned like the live You page", () => {
    render(<YouPageSkeleton />);

    const identity = screen.getByTestId("you-loading-identity");

    expect(identity.tagName).toBe("HEADER");
    expect(identity).toHaveClass("flex", "w-full", "items-start", "gap-4");
    expect(identity.className.split(/\s+/)).not.toContain("flex-col");
    expect(identity.className.split(/\s+/)).not.toContain("items-center");
    expect(identity.className.split(/\s+/)).not.toContain("justify-center");

    expect(screen.getByTestId("you-loading-credits")).toBeInTheDocument();
    expect(screen.getByTestId("you-loading-menu")).toBeInTheDocument();
  });

  it("uses the same shell width and padding as the You page", () => {
    const { container } = render(<YouPageSkeleton />);
    const shell = container.firstElementChild;

    expect(shell?.className).toContain("mx-auto");
    expect(shell?.className).toContain("md:max-w-4xl");
    expect(shell?.className).toContain("py-6");
    expect(shell?.className).not.toContain("max-w-lg");
    expect(shell?.className).not.toContain("items-center");
  });
});
