import { describe, expect, it } from "vitest";

import {
  orderSidebarProjects,
  SIDEBAR_PROJECT_ROW_CAP,
} from "./order-sidebar-projects";

/** Core hands the sidebar a page sorted by latest activity. */
const projects = [
  { id: "a" },
  { id: "b" },
  { id: "c" },
  { id: "d" },
  { id: "e" },
  { id: "f" },
  { id: "g" },
];

function ids(rows: { id: string }[]): string[] {
  return rows.map((row) => row.id);
}

describe("orderSidebarProjects", () => {
  it("falls back to activity order when the reader has no pins or history", () => {
    const { rows } = orderSidebarProjects({
      projects,
      pinnedIds: [],
      visitedIds: [],
    });

    expect(ids(rows)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("never renders more than the cap without pins", () => {
    const { rows } = orderSidebarProjects({
      projects,
      pinnedIds: [],
      visitedIds: [],
    });

    expect(rows).toHaveLength(SIDEBAR_PROJECT_ROW_CAP);
  });

  it("puts last-visited ahead of activity order", () => {
    const { rows } = orderSidebarProjects({
      projects,
      pinnedIds: [],
      visitedIds: ["g", "f"],
    });

    expect(ids(rows)).toEqual(["g", "f", "a", "b", "c"]);
  });

  it("puts pins first, in the reader's order", () => {
    const { rows } = orderSidebarProjects({
      projects,
      pinnedIds: ["f", "b"],
      visitedIds: ["g"],
    });

    expect(ids(rows)).toEqual(["f", "b", "g", "a", "c"]);
  });

  it("lets pins claim slots rather than add rows", () => {
    const { rows } = orderSidebarProjects({
      projects,
      pinnedIds: ["g", "f", "e", "d", "c"],
      visitedIds: ["a", "b"],
    });

    expect(ids(rows)).toEqual(["g", "f", "e", "d", "c"]);
  });

  it("caps pins too, so the popover is always the same height", () => {
    const { rows } = orderSidebarProjects({
      projects,
      pinnedIds: ["g", "f", "e", "d", "c", "b"],
      visitedIds: ["a"],
    });

    // The chat sidebar renders every pin; this list cannot, because a popover
    // has no scrollbar of its own to lean on. `All projects` reaches "b".
    expect(ids(rows)).toEqual(["g", "f", "e", "d", "c"]);
  });

  it("reports how long the pinned run is, so the panel can divide it", () => {
    const { rows, pinnedCount } = orderSidebarProjects({
      projects,
      pinnedIds: ["g", "f"],
      visitedIds: ["a"],
    });

    expect(pinnedCount).toBe(2);
    expect(ids(rows).slice(0, pinnedCount)).toEqual(["g", "f"]);
  });

  it("reports a zero pinned run when the reader has no pins", () => {
    const { pinnedCount } = orderSidebarProjects({
      projects,
      pinnedIds: [],
      visitedIds: ["a"],
    });

    expect(pinnedCount).toBe(0);
  });

  it("lists a pinned project once, not again under recents", () => {
    const { rows } = orderSidebarProjects({
      projects,
      pinnedIds: ["c"],
      visitedIds: ["c", "a"],
    });

    expect(ids(rows)).toEqual(["c", "a", "b", "d", "e"]);
  });

  it("keeps the recents budget when a pin is missing from this page", () => {
    const { rows } = orderSidebarProjects({
      projects,
      pinnedIds: ["gone"],
      visitedIds: ["g"],
    });

    expect(ids(rows)).toEqual(["g", "a", "b", "c", "d"]);
  });

  it("skips visited projects that are missing from this page", () => {
    const { rows } = orderSidebarProjects({
      projects,
      pinnedIds: [],
      visitedIds: ["gone", "g"],
    });

    expect(ids(rows)).toEqual(["g", "a", "b", "c", "d"]);
  });

  it("renders a workspace smaller than the cap in full", () => {
    const { rows } = orderSidebarProjects({
      projects: [{ id: "a" }, { id: "b" }],
      pinnedIds: [],
      visitedIds: [],
    });

    expect(ids(rows)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty workspace", () => {
    const { rows } = orderSidebarProjects({
      projects: [],
      pinnedIds: ["a"],
      visitedIds: ["b"],
    });

    expect(rows).toEqual([]);
  });
});
