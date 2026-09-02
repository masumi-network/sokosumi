import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { YouPageSkeleton } from "./you-loading-view";

describe("YouPageSkeleton", () => {
  it("mirrors the live You identity header layout", () => {
    render(<YouPageSkeleton />);

    expect(screen.getByTestId("you-loading-identity")).toHaveClass(
      "flex",
      "items-start",
      "gap-4",
    );
    expect(screen.getByTestId("you-loading-credits")).toBeInTheDocument();
    expect(screen.getByTestId("you-loading-menu")).toBeInTheDocument();
  });

  it("uses the same shell width as the You page", () => {
    const { container } = render(<YouPageSkeleton />);
    const shell = container.firstElementChild;
    expect(shell?.className).toContain("md:max-w-4xl");
    expect(shell?.className).not.toContain("max-w-lg");
  });
});
