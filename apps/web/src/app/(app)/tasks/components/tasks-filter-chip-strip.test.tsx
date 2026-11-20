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
      <li>Status: Draft</li>
      <li>Stuck: 3+ days</li>
    </TasksFilterChipStrip>,
  );
}

describe("TasksFilterChipStrip", () => {
  it("shows no edge cue when every chip fits", () => {
    sizeLists(200, 200);
    const { container } = renderStrip();

    expect(container.querySelector("[data-chip-strip-scroll]")).toBeNull();
    expect(screen.getByRole("list").style.maskImage).toBe("");
  });

  it("fades the clipped end and offers an arrow, without scroll-driven animation", () => {
    sizeLists(400, 200);
    const { container } = renderStrip();

    const list = screen.getByRole("list", { name: "Active filters" });
    expect(list).toHaveAttribute("data-overflow-end");
    expect(list.style.maskImage).toContain("transparent");
    expect(list.className).not.toContain("scroll-edge");
    expect(
      container.querySelector('[data-chip-strip-scroll="end"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-chip-strip-scroll="start"]'),
    ).toBeNull();
  });

  it("shows the start arrow once scrolled", () => {
    sizeLists(400, 200);
    const { container } = renderStrip();
    const list = screen.getByRole("list");

    act(() => {
      Object.defineProperty(list, "scrollLeft", {
        configurable: true,
        value: 200,
      });
      list.dispatchEvent(new Event("scroll"));
    });

    expect(
      container.querySelector('[data-chip-strip-scroll="start"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-chip-strip-scroll="end"]'),
    ).toBeNull();
  });
});
