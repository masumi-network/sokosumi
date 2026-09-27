import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ProjectsLoadingView,
  ProjectsPageSkeleton,
} from "@/app/projects/components/projects-loading-view";
import {
  PROJECTS_BROWSE_DIVIDE_CLASS,
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
} from "@/app/projects/constants";

describe("ProjectsPageSkeleton", () => {
  it("renders Instant page shell without labels or copy", () => {
    const { container } = render(<ProjectsPageSkeleton />);

    expect(container.firstElementChild?.className).toContain("w-full");
    expect(container.firstElementChild?.className).not.toContain("px-2");
    expect(container.firstElementChild?.className).not.toContain("-mx-4");
    expect(screen.getByTestId("projects-loading")).toBeTruthy();
    expect(screen.getByTestId("projects-loading-browse")).toBeTruthy();
    expect(container.textContent?.trim()).toBe("");
  });

  it("uses a non-textual skeleton for the desktop create control", () => {
    render(<ProjectsPageSkeleton />);

    const createSlot = screen.getByTestId("projects-loading-create");
    expect(createSlot.className).toContain("hidden");
    expect(createSlot.className).toContain("md:inline-flex");
    // No accessible button with English (or any) create label.
    expect(createSlot.tagName).not.toBe("BUTTON");
  });

  it("reserves the create control above the list", () => {
    render(<ProjectsPageSkeleton />);

    const header = screen.getByTestId("projects-loading-toolbar");

    expect(header).toContainElement(
      screen.getByTestId("projects-loading-create"),
    );
  });
});

describe("ProjectsLoadingView", () => {
  it("hides header create below md and pads for the mobile FAB", () => {
    const { container } = render(<ProjectsLoadingView />);

    const create = screen.getByTestId("projects-loading-create");
    expect(create.className).toContain("hidden");
    expect(create.className).toContain("md:inline-flex");
    // Loading toolbar reserves the same space as the live controls.
    expect(container.firstElementChild?.firstElementChild).toBe(
      screen.getByTestId("projects-loading-toolbar"),
    );
    expect(container.firstElementChild?.className).toContain(
      "pb-[calc(3.5rem+1rem)]",
    );
    expect(container.firstElementChild?.className).toContain("md:pb-0");
  });

  it("reserves browse chrome and stable item size to limit Instant swap CLS", () => {
    const { container } = render(<ProjectsLoadingView />);

    const browse = screen.getByTestId("projects-loading-browse");
    expect(browse).toHaveClass(
      "bg-card-background",
      "rounded-xl",
      PROJECTS_LIST_CARD_MIN_H_CLASS,
    );
    expect(browse).not.toHaveClass("border");
    const header = screen.getByTestId("projects-loading-toolbar");
    expect(browse).not.toContainElement(header);
    expect(header.querySelector('[data-slot="skeleton"]')).toHaveClass(
      "h-10",
      "md:w-64",
    );

    const divide = browse.lastElementChild;
    for (const token of PROJECTS_BROWSE_DIVIDE_CLASS.split(/\s+/)) {
      expect(divide?.className).toContain(token);
    }

    const items = browse.querySelectorAll("article");
    expect(items.length).toBe(4);

    for (const item of items) {
      const row = item.firstElementChild;
      expect(row?.className).toContain("flex-row");
      expect(row?.className).toContain("items-center");
      expect(row?.className).toContain("gap-4");
      expect(row?.className).toContain("rounded-none");
      expect(row?.className).not.toContain("-mx-2");
      expect(row?.className).not.toContain("border-border");
      expect(row?.className).not.toContain("bg-overlay");
      expect(row?.className.split(/\s+/)).not.toContain("border");
      // Avatar + name + briefing + one count pill + activity stamp; no
      // overflow actions column.
      expect(item.querySelectorAll('[data-slot="skeleton"]').length).toBe(5);
      for (const token of PROJECTS_LIST_ROW_LAYOUT_CLASS.split(/\s+/)) {
        expect(item.className).toContain(token);
      }
    }

    // Outer shell matches ProjectsView flex column + FAB clearance.
    expect(container.firstElementChild?.className).toContain("flex");
    expect(container.firstElementChild?.className).toContain("flex-col");
    expect(container.firstElementChild?.className).toContain("gap-5");
  });
});
