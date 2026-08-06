import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DeveloperDetailPageSkeleton,
  DeveloperSectionPageSkeleton,
} from "../developer-loading-view";

describe("DeveloperSectionPageSkeleton", () => {
  it("renders section header and list skeleton regions", () => {
    render(<DeveloperSectionPageSkeleton />);

    expect(screen.getByTestId("developer-section-loading")).toBeTruthy();
    expect(screen.getByTestId("developer-section-loading-list")).toBeTruthy();
  });

  it("renders multiple skeleton bones", () => {
    const { container } = render(<DeveloperSectionPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(10);
  });
});

describe("DeveloperDetailPageSkeleton", () => {
  it("renders detail skeleton region", () => {
    render(<DeveloperDetailPageSkeleton />);

    expect(screen.getByTestId("developer-detail-loading")).toBeTruthy();
  });

  it("renders multiple skeleton bones", () => {
    const { container } = render(<DeveloperDetailPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(8);
  });
});
