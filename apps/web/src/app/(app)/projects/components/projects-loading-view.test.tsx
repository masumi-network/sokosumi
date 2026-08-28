import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ProjectsLoadingView,
  ProjectsPageSkeleton,
} from "@/app/projects/components/projects-loading-view";
import {
  PROJECTS_ITEM_LAYOUT_CLASS,
  PROJECTS_LIST_CARD_MIN_H_CLASS,
} from "@/app/projects/constants";

describe("ProjectsPageSkeleton", () => {
  it("renders Instant page shell without labels or copy", () => {
    const { container } = render(<ProjectsPageSkeleton />);

    expect(container.firstElementChild?.className).toContain("w-full");
    expect(container.firstElementChild?.className).toContain("px-2");
    expect(screen.getByTestId("projects-loading")).toBeTruthy();
    expect(screen.getByTestId("projects-loading-browse")).toBeTruthy();
    expect(container.textContent?.trim()).toBe("");
  });

  it("uses a non-textual skeleton for the desktop create control", () => {
    render(<ProjectsPageSkeleton />);

    const createSlot = screen.getByTestId("projects-loading-create");
    expect(createSlot.className).toContain("hidden");
    expect(createSlot.className).toContain("md:flex");
    expect(createSlot.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    // No accessible button with English (or any) create label.
    expect(createSlot.querySelector("button")).toBeNull();
  });
});

describe("ProjectsLoadingView", () => {
  it("hides header create below md and pads for the mobile FAB", () => {
    const { container } = render(<ProjectsLoadingView />);

    const headerRow = screen.getByTestId("projects-loading-create");
    expect(headerRow.className).toContain("hidden");
    expect(headerRow.className).toContain("md:flex");
    expect(container.firstElementChild?.className).toContain(
      "pb-[calc(3.5rem+1rem)]",
    );
    expect(container.firstElementChild?.className).toContain("md:pb-0");
  });

  it("reserves browse chrome and stable item size to limit Instant swap CLS", () => {
    const { container } = render(<ProjectsLoadingView />);

    const browse = screen.getByTestId("projects-loading-browse");
    expect(browse.className).toContain("grid");
    expect(browse.className).toContain("grid-cols-2");
    expect(browse.className).toContain("md:grid-cols-1");
    expect(browse.className).toContain(PROJECTS_LIST_CARD_MIN_H_CLASS);

    const items = browse.querySelectorAll("article");
    expect(items.length).toBe(4);

    for (const item of items) {
      const card = item.firstElementChild;
      expect(card?.className).toContain("border");
      expect(card?.className).toContain("md:border-0");
      for (const token of PROJECTS_ITEM_LAYOUT_CLASS.split(/\s+/)) {
        expect(item.className).toContain(token);
      }
    }

    // Outer shell matches ProjectsView flex column + FAB clearance.
    expect(container.firstElementChild?.className).toContain("flex");
    expect(container.firstElementChild?.className).toContain("flex-col");
    expect(container.firstElementChild?.className).toContain("gap-5");
  });
});
