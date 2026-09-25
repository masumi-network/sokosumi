import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BreadcrumbLandmarkContext } from "./breadcrumb-navigation.client";
import BreadcrumbNavigationSkeleton from "./breadcrumb-navigation.skeleton";

/** The list's children in order: crumbs and the separators between them. */
function trail(list: Element | null) {
  return Array.from(list?.children ?? [], (child) =>
    child.getAttribute("data-slot"),
  );
}

const TWO_CRUMBS = [
  "breadcrumb-item",
  "breadcrumb-separator",
  "breadcrumb-item",
];

describe("BreadcrumbNavigationSkeleton", () => {
  it("renders its own breadcrumb landmark by default", () => {
    render(<BreadcrumbNavigationSkeleton />);

    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(nav.querySelectorAll("ol")).toHaveLength(1);
    expect(trail(nav.querySelector("ol"))).toEqual(TWO_CRUMBS);
  });

  it("renders bare items inside a parent that owns the landmark", () => {
    render(
      <nav aria-label="breadcrumb">
        <ol>
          <BreadcrumbLandmarkContext value={{ ownsLandmark: false }}>
            <BreadcrumbNavigationSkeleton />
          </BreadcrumbLandmarkContext>
        </ol>
      </nav>,
    );

    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(nav.querySelectorAll("ol")).toHaveLength(1);
    expect(trail(nav.querySelector("ol"))).toEqual(TWO_CRUMBS);
  });
});
