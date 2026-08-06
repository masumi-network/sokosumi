import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HistoryPageSkeleton } from "../history-loading-view";

describe("HistoryPageSkeleton", () => {
  it("renders toolbar and list skeleton regions", () => {
    render(<HistoryPageSkeleton />);

    expect(screen.getByTestId("history-loading-toolbar")).toBeTruthy();
    expect(screen.getByTestId("history-loading-list")).toBeTruthy();
  });

  it("renders multiple skeleton bones", () => {
    const { container } = render(<HistoryPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(8);
  });
});
