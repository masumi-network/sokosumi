import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DeveloperDetailPageSkeleton,
  DeveloperListPageSkeleton,
  DeveloperSectionContentSkeleton,
  DeveloperSectionPageSkeleton,
  DeveloperSectionRowsSkeleton,
  DeveloperTaskDetailPageSkeleton,
} from "./developer-loading-view";

describe("DeveloperSectionPageSkeleton", () => {
  it("renders card section header and list skeleton regions", () => {
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

describe("DeveloperListPageSkeleton", () => {
  it("renders non-card list skeleton regions", () => {
    render(<DeveloperListPageSkeleton />);

    expect(screen.getByTestId("developer-list-loading")).toBeTruthy();
    expect(
      screen.getByTestId("developer-section-content-loading"),
    ).toBeTruthy();
    expect(screen.getByTestId("developer-section-loading-list")).toBeTruthy();
  });
});

describe("DeveloperSectionContentSkeleton", () => {
  it("renders content and list skeleton regions", () => {
    render(<DeveloperSectionContentSkeleton />);

    expect(
      screen.getByTestId("developer-section-content-loading"),
    ).toBeTruthy();
    expect(screen.getByTestId("developer-section-loading-list")).toBeTruthy();
  });
});

describe("DeveloperSectionRowsSkeleton", () => {
  it("renders list rows only", () => {
    const { container } = render(<DeveloperSectionRowsSkeleton rows={3} />);

    expect(screen.getByTestId("developer-section-loading-list")).toBeTruthy();
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(6);
  });
});

describe("DeveloperDetailPageSkeleton", () => {
  it("renders form detail skeleton at max-w-3xl", () => {
    const { container } = render(<DeveloperDetailPageSkeleton />);

    expect(screen.getByTestId("developer-detail-loading")).toBeTruthy();
    expect(container.querySelector(".max-w-3xl")).toBeTruthy();
  });

  it("renders multiple skeleton bones", () => {
    const { container } = render(<DeveloperDetailPageSkeleton />);
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(8);
  });
});

describe("DeveloperTaskDetailPageSkeleton", () => {
  it("renders meta bar and task section skeleton regions", () => {
    const { container } = render(<DeveloperTaskDetailPageSkeleton />);

    expect(screen.getByTestId("developer-task-detail-loading")).toBeTruthy();
    expect(container.querySelector(".max-w-4xl")).toBeTruthy();
    const bones = container.querySelectorAll('[data-slot="skeleton"]');
    expect(bones.length).toBeGreaterThanOrEqual(12);
  });
});
