import { describe, expect, it } from "vitest";

import {
  driveItemsListClass,
  driveRecentsDayItemsClass,
} from "@/app/drive/components/drive-view-layout";

describe("Files grid column breakpoints", () => {
  it("uses 2 / sm:2 / lg:3 / xl:5 for Browse item grids", () => {
    const gridClass = driveItemsListClass("grid");

    expect(gridClass).toBe(
      "grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
    );
    expect(gridClass).not.toContain("sm:grid-cols-3");
    expect(gridClass).not.toContain("lg:grid-cols-4");
    expect(gridClass).not.toContain("md:grid-cols-4");
  });

  it("shares the same column scale for Recents day groups", () => {
    expect(driveRecentsDayItemsClass("grid")).toBe(driveItemsListClass("grid"));
  });

  it("keeps list mode distinct from the grid class contract", () => {
    const listClass = driveItemsListClass("list");
    const recentsListClass = driveRecentsDayItemsClass("list");

    expect(listClass).not.toContain("grid-cols-2");
    expect(listClass).not.toContain("lg:grid-cols-3");
    expect(listClass).not.toContain("xl:grid-cols-5");
    expect(recentsListClass).not.toContain("grid-cols-2");
    expect(recentsListClass).not.toBe(driveItemsListClass("grid"));
  });
});
