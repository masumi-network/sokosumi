import { describe, expect, it } from "vitest";

import {
  driveListSortBySchema,
  driveListSortOrderSchema,
  resolveDriveListSort,
} from "@/schemas/drive-list-sort.schema";

describe("driveListSort schemas", () => {
  it("accepts name, date, type and asc, desc", () => {
    expect(driveListSortBySchema.parse("name")).toBe("name");
    expect(driveListSortBySchema.parse("date")).toBe("date");
    expect(driveListSortBySchema.parse("type")).toBe("type");
    expect(driveListSortOrderSchema.parse("asc")).toBe("asc");
    expect(driveListSortOrderSchema.parse("desc")).toBe("desc");
  });

  it("treats omit as undefined", () => {
    expect(driveListSortBySchema.parse(undefined)).toBeUndefined();
    expect(driveListSortOrderSchema.parse(undefined)).toBeUndefined();
  });

  it("rejects invalid values", () => {
    expect(() => driveListSortBySchema.parse("size")).toThrow();
    expect(() => driveListSortOrderSchema.parse("up")).toThrow();
  });
});

describe("resolveDriveListSort", () => {
  it("returns null when both omitted", () => {
    expect(resolveDriveListSort({}, "name")).toBeNull();
  });

  it("defaults sortOrder by key when only sortBy is set", () => {
    expect(resolveDriveListSort({ sortBy: "name" }, "date")).toEqual({
      sortBy: "name",
      sortOrder: "asc",
    });
    expect(resolveDriveListSort({ sortBy: "date" }, "name")).toEqual({
      sortBy: "date",
      sortOrder: "desc",
    });
    expect(resolveDriveListSort({ sortBy: "type" }, "date")).toEqual({
      sortBy: "type",
      sortOrder: "asc",
    });
  });

  it("uses endpoint default key when only sortOrder is set", () => {
    expect(resolveDriveListSort({ sortOrder: "desc" }, "name")).toEqual({
      sortBy: "name",
      sortOrder: "desc",
    });
    expect(resolveDriveListSort({ sortOrder: "asc" }, "date")).toEqual({
      sortBy: "date",
      sortOrder: "asc",
    });
  });
});
