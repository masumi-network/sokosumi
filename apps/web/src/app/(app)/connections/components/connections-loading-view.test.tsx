import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionsPageSkeleton } from "./connections-loading-view";

describe("ConnectionsPageSkeleton", () => {
  it("renders social, tabs, and content skeleton regions", () => {
    render(<ConnectionsPageSkeleton />);

    expect(screen.getByTestId("connections-loading")).toBeTruthy();
    expect(screen.getByTestId("connections-loading-social")).toBeTruthy();
    expect(screen.getByTestId("connections-loading-tabs")).toBeTruthy();
    expect(screen.getByTestId("connections-loading-content")).toBeTruthy();
  });

  it("renders multiple skeleton bones", () => {
    const { container } = render(<ConnectionsPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(10);
  });
});
