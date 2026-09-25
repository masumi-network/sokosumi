import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BreadcrumbLandmarkContext } from "./breadcrumb-navigation.client";
import BreadcrumbNavigationSkeleton from "./breadcrumb-navigation.skeleton";

describe("BreadcrumbNavigationSkeleton", () => {
  it("renders its own breadcrumb landmark by default", () => {
    render(<BreadcrumbNavigationSkeleton />);

    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(nav.querySelectorAll("ol")).toHaveLength(1);
  });

  it("renders bare items inside a parent that owns the landmark", () => {
    render(
      <nav aria-label="breadcrumb">
        <ol>
          <BreadcrumbLandmarkContext value={false}>
            <BreadcrumbNavigationSkeleton />
          </BreadcrumbLandmarkContext>
        </ol>
      </nav>,
    );

    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(nav.querySelectorAll("ol")).toHaveLength(1);
    expect(nav.querySelectorAll("li[data-slot=breadcrumb-item]")).toHaveLength(
      2,
    );
  });
});
