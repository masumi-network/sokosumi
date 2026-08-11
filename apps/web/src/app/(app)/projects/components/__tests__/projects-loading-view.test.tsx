import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PROJECTS_LOADING_DEFAULT_LABELS,
  ProjectsLoadingView,
  ProjectsPageSkeleton,
} from "@/app/projects/components/projects-loading-view";

describe("ProjectsPageSkeleton", () => {
  it("renders Instant page shell without requiring labels props", () => {
    const { container } = render(<ProjectsPageSkeleton />);

    expect(container.firstElementChild?.className).toContain("w-full");
    expect(container.firstElementChild?.className).toContain("px-2");
    expect(screen.getByTestId("projects-loading")).toBeTruthy();
    expect(screen.getByTestId("projects-loading-list")).toBeTruthy();
  });

  it("uses default New project label on the desktop create control", () => {
    render(<ProjectsPageSkeleton />);

    expect(
      screen.getByRole("button", {
        name: PROJECTS_LOADING_DEFAULT_LABELS.newProject,
      }),
    ).toBeDisabled();
  });
});

describe("ProjectsLoadingView", () => {
  it("hides header create below md and pads for the mobile FAB", () => {
    const { container } = render(
      <ProjectsLoadingView labels={PROJECTS_LOADING_DEFAULT_LABELS} />,
    );

    const headerRow = container.querySelector(".hidden.justify-end.md\\:flex");
    expect(headerRow).toBeTruthy();
    expect(container.firstElementChild?.className).toContain(
      "pb-[calc(3.5rem+1rem)]",
    );
    expect(container.firstElementChild?.className).toContain("md:pb-0");
  });

  it("reserves list chrome and stable row size to limit Instant swap CLS", () => {
    const { container } = render(
      <ProjectsLoadingView labels={PROJECTS_LOADING_DEFAULT_LABELS} />,
    );

    const list = screen.getByTestId("projects-loading-list");
    expect(list.className).toContain("divide-y");

    const rows = list.querySelectorAll("article");
    expect(rows.length).toBe(4);

    for (const row of rows) {
      expect(row.className).toContain("[contain-intrinsic-size:auto_72px]");
      expect(row.className).toContain("[content-visibility:auto]");
    }

    // List card min-height tracks empty-state chrome so empty swap is smaller.
    const listCard = list.parentElement;
    expect(listCard?.className).toMatch(/min-h-\[320px\]/);

    // Outer shell matches ProjectsView flex column + FAB clearance.
    expect(container.firstElementChild?.className).toContain("flex");
    expect(container.firstElementChild?.className).toContain("flex-col");
    expect(container.firstElementChild?.className).toContain("gap-5");
  });
});
