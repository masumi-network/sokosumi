import { describe, expect, it } from "vitest";

import {
  compareDriveBrowseItems,
  decodeDriveBrowseSortCursor,
  encodeDriveBrowseSortCursor,
  paginateSortedDriveBrowseItems,
  sortDriveBrowseItems,
} from "@/helpers/drive-browse-sort";
import type { DriveItem } from "@/schemas/drive-file.schema";

const SECRET = "browse-sort-secret";
const BINDING = {
  prefix: "drive/users/u/",
  searchQuery: "",
  sortBy: "name" as const,
  sortOrder: "asc" as const,
};

function folder(name: string): DriveItem {
  return { type: "folder", name, path: name };
}

function file(
  name: string,
  uploadedAt: string,
  pathname = `drive/users/u/${name}`,
): DriveItem {
  return {
    type: "file",
    name,
    fileUrl: `https://example.com/${name}`,
    pathname,
    size: 10,
    uploadedAt,
  };
}

describe("compareDriveBrowseItems", () => {
  it("keeps folders before files for every sort key", () => {
    const f = folder("Zulu");
    const a = file("alpha.pdf", "2026-01-01T00:00:00.000Z");

    for (const sort of [
      { sortBy: "name" as const, sortOrder: "asc" as const },
      { sortBy: "name" as const, sortOrder: "desc" as const },
      { sortBy: "date" as const, sortOrder: "desc" as const },
      { sortBy: "type" as const, sortOrder: "asc" as const },
    ]) {
      expect(compareDriveBrowseItems(f, a, sort)).toBeLessThan(0);
      expect(compareDriveBrowseItems(a, f, sort)).toBeGreaterThan(0);
    }
  });

  it("sorts files by name", () => {
    const a = file("alpha.pdf", "2026-01-02T00:00:00.000Z");
    const b = file("beta.pdf", "2026-01-01T00:00:00.000Z");
    expect(
      compareDriveBrowseItems(a, b, { sortBy: "name", sortOrder: "asc" }),
    ).toBeLessThan(0);
    expect(
      compareDriveBrowseItems(a, b, { sortBy: "name", sortOrder: "desc" }),
    ).toBeGreaterThan(0);
  });

  it("sorts files by uploadedAt for date", () => {
    const older = file("a.pdf", "2026-01-01T00:00:00.000Z");
    const newer = file("b.pdf", "2026-01-02T00:00:00.000Z");
    expect(
      compareDriveBrowseItems(newer, older, {
        sortBy: "date",
        sortOrder: "desc",
      }),
    ).toBeLessThan(0);
  });

  it("applies sortOrder to name tie-break when date matches", () => {
    const sameDate = "2026-01-01T00:00:00.000Z";
    const alpha = file("alpha.pdf", sameDate);
    const beta = file("beta.pdf", sameDate);

    expect(
      compareDriveBrowseItems(alpha, beta, {
        sortBy: "date",
        sortOrder: "asc",
      }),
    ).toBeLessThan(0);
    expect(
      compareDriveBrowseItems(alpha, beta, {
        sortBy: "date",
        sortOrder: "desc",
      }),
    ).toBeGreaterThan(0);
  });

  it("sorts files by type family then name", () => {
    const pdf = file("z.pdf", "2026-01-01T00:00:00.000Z");
    const png = file("a.png", "2026-01-01T00:00:00.000Z");
    const sorted = sortDriveBrowseItems([png, pdf], {
      sortBy: "type",
      sortOrder: "asc",
    });
    // image ranks before pdf
    expect(sorted.map((i) => i.name)).toEqual(["a.png", "z.pdf"]);
  });
});

describe("paginateSortedDriveBrowseItems", () => {
  it("continues pages under a stable sort without repeating items", () => {
    const items = sortDriveBrowseItems(
      [
        folder("Docs"),
        file("a.pdf", "2026-01-01T00:00:00.000Z"),
        file("b.pdf", "2026-01-02T00:00:00.000Z"),
        file("c.pdf", "2026-01-03T00:00:00.000Z"),
      ],
      { sortBy: "name", sortOrder: "asc" },
    );

    const first = paginateSortedDriveBrowseItems({
      items,
      sort: { sortBy: "name", sortOrder: "asc" },
      limit: 2,
      cursorSecret: SECRET,
      cursorBinding: BINDING,
    });
    expect(first.page.map((i) => i.name)).toEqual(["Docs", "a.pdf"]);
    expect(first.nextCursor).toBeTruthy();

    const second = paginateSortedDriveBrowseItems({
      items,
      sort: { sortBy: "name", sortOrder: "asc" },
      limit: 2,
      cursor: first.nextCursor!,
      cursorSecret: SECRET,
      cursorBinding: BINDING,
    });
    expect(second.page.map((i) => i.name)).toEqual(["b.pdf", "c.pdf"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects cursors signed for a different sort binding", () => {
    const item = file("a.pdf", "2026-01-01T00:00:00.000Z");
    const encoded = encodeDriveBrowseSortCursor({
      lastItem: item,
      cursorSecret: SECRET,
      cursorBinding: BINDING,
    });

    expect(() =>
      decodeDriveBrowseSortCursor(encoded, {
        cursorSecret: SECRET,
        cursorBinding: { ...BINDING, sortOrder: "desc" },
      }),
    ).toThrow("Invalid pagination cursor");
  });
});
