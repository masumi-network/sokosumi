import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TasksFilterChipStrip } from "./tasks-filter-chip-strip";

const ORIGINAL = {
  scrollWidth: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollWidth",
  ),
  clientWidth: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  ),
};

function sizeLists(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return this.tagName === "UL" ? scrollWidth : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return this.tagName === "UL" ? clientWidth : 0;
    },
  });
}

afterEach(() => {
  for (const [key, descriptor] of Object.entries(ORIGINAL)) {
    if (descriptor)
      Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
});

function renderStrip() {
  return render(
    <TasksFilterChipStrip label="Active filters" itemsKey="a|b">
      <li>
        Status: Draft <button type="button">Remove Status: Draft</button>
      </li>
      <li>
        Stuck: 3+ days <button type="button">Remove Stuck: 3+ days</button>
      </li>
    </TasksFilterChipStrip>,
  );
}

describe("TasksFilterChipStrip", () => {
  it("is a named region the keyboard reaches and pans, with no other controls", () => {
    sizeLists(400, 200);
    renderStrip();

    const list = screen.getByRole("list", { name: "Active filters" });
    expect(list).toHaveAttribute("tabindex", "0");
    // Focus on a chip scrolls it clear of the edge fades.
    expect(list).toHaveClass("scroll-px-6");
    // Only the chips' own remove buttons: no overlay controls.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Remove Status: Draft",
      "Remove Stuck: 3+ days",
    ]);
  });

  it("shows no fade when every chip fits", () => {
    sizeLists(200, 200);
    renderStrip();

    expect(screen.getByRole("list").style.maskImage).toBe("");
  });

  it("fades only the clipped edge, without scroll-driven animation", () => {
    sizeLists(400, 200);
    renderStrip();

    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("data-overflow-end");
    expect(list).not.toHaveAttribute("data-overflow-start");
    expect(list.style.maskImage).toMatch(/^linear-gradient\(to right, black,/);
    expect(list.className).not.toContain("scroll-edge");
  });

  it("fades the start once scrolled to the end", () => {
    sizeLists(400, 200);
    renderStrip();
    const list = screen.getByRole("list");

    act(() => {
      Object.defineProperty(list, "scrollLeft", {
        configurable: true,
        value: 200,
      });
      list.dispatchEvent(new Event("scroll"));
    });

    expect(list).toHaveAttribute("data-overflow-start");
    expect(list).not.toHaveAttribute("data-overflow-end");
    expect(list.style.maskImage).toMatch(/black\)$/);
  });
});
