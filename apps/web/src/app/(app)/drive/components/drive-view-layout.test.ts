import { describe, expect, it } from "vitest";

import {
  driveItemBodyClass,
  driveItemMetaMobileClass,
  driveItemsListClass,
  driveRecentsDayItemsClass,
} from "@/app/drive/components/drive-view-layout";

describe("Files grid column breakpoints", () => {
  it("uses 2 / sm:3 / lg:4 / xl:5 for Browse item grids", () => {
    const gridClass = driveItemsListClass("grid");

    expect(gridClass).toContain("grid-cols-2");
    expect(gridClass).toContain("sm:grid-cols-3");
    expect(gridClass).toContain("lg:grid-cols-4");
    expect(gridClass).toContain("xl:grid-cols-5");
    expect(gridClass).not.toContain("md:grid-cols-4");
  });

  it("shares the same column scale for Recents day groups", () => {
    expect(driveRecentsDayItemsClass("grid")).toBe(driveItemsListClass("grid"));
  });

  it("keeps list mode distinct from the grid class contract", () => {
    const listClass = driveItemsListClass("list");
    const recentsListClass = driveRecentsDayItemsClass("list");

    expect(listClass).not.toContain("grid-cols-2");
    expect(listClass).not.toContain("sm:grid-cols-3");
    expect(listClass).not.toContain("lg:grid-cols-4");
    expect(listClass).not.toContain("xl:grid-cols-5");
    expect(recentsListClass).not.toContain("grid-cols-2");
    expect(recentsListClass).not.toBe(driveItemsListClass("grid"));
  });
});

describe("Files grid card body stacking", () => {
  it("uses a two-column CSS grid body so meta can span under icon|name", () => {
    const gridBody = driveItemBodyClass("grid");

    expect(gridBody).toContain("grid");
    expect(gridBody).toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(gridBody).toContain("flex-1");
    expect(gridBody).not.toContain("items-center gap-2");
    expect(gridBody).not.toMatch(/(?:^|\s)flex(?:\s|$)/);
  });

  it("puts grid meta on its own row via col-span-2", () => {
    const gridMeta = driveItemMetaMobileClass("grid");

    expect(gridMeta).toContain("col-span-2");
    expect(gridMeta).toContain("min-w-0");
  });

  it("keeps list body as a horizontal flex row", () => {
    const listBody = driveItemBodyClass("list");

    expect(listBody).toContain("flex");
    expect(listBody).toContain("items-center");
    expect(listBody).not.toContain("grid-cols-");
  });

  it("keeps list mobile meta hidden from md up", () => {
    const listMeta = driveItemMetaMobileClass("list");

    expect(listMeta).toContain("md:hidden");
    expect(listMeta).not.toContain("col-span-2");
  });
});
