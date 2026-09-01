import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILES_SORT_SELECTION,
  defaultSortOrderForKey,
  effectiveFilesSortSelection,
  filesSortUrlValues,
  parseFilesSortSelection,
  toDriveListSortQuery,
  toggleSortOrder,
  toStoredFilesSortSelection,
} from "@/lib/utils/files-sort";

describe("parseFilesSortSelection", () => {
  it("returns null when both params are omitted (server default)", () => {
    expect(parseFilesSortSelection(null, null)).toBeNull();
    expect(parseFilesSortSelection(undefined, undefined)).toBeNull();
  });

  it("parses a full selection from URL params", () => {
    expect(parseFilesSortSelection("name", "desc")).toEqual({
      sortBy: "name",
      sortOrder: "desc",
    });
  });

  it("fills default order when only sortBy is present", () => {
    expect(parseFilesSortSelection("date", null)).toEqual({
      sortBy: "date",
      sortOrder: "desc",
    });
    expect(parseFilesSortSelection("type", null)).toEqual({
      sortBy: "type",
      sortOrder: "asc",
    });
  });

  it("rejects order-only params (shared URL always pairs both when set)", () => {
    expect(parseFilesSortSelection(null, "asc")).toBeNull();
  });

  it("rejects invalid values as null (no silent remap)", () => {
    expect(parseFilesSortSelection("size", "asc")).toBeNull();
    expect(parseFilesSortSelection("name", "sideways")).toBeNull();
  });
});

describe("effective and stored files sort selection", () => {
  it("treats omitted selection as date descending in the control", () => {
    expect(effectiveFilesSortSelection(null)).toEqual(
      DEFAULT_FILES_SORT_SELECTION,
    );
  });

  it("collapses date descending back to omit for clean URLs", () => {
    expect(
      toStoredFilesSortSelection({ sortBy: "date", sortOrder: "desc" }),
    ).toBeNull();
    expect(
      toStoredFilesSortSelection({ sortBy: "date", sortOrder: "asc" }),
    ).toEqual({ sortBy: "date", sortOrder: "asc" });
    expect(
      toStoredFilesSortSelection({ sortBy: "name", sortOrder: "asc" }),
    ).toEqual({ sortBy: "name", sortOrder: "asc" });
  });
});

describe("filesSortUrlValues", () => {
  it("omits default so clean links stay clean", () => {
    expect(filesSortUrlValues(null)).toEqual({
      sortBy: null,
      sortOrder: null,
    });
  });

  it("persists active sort in URL values", () => {
    expect(filesSortUrlValues({ sortBy: "type", sortOrder: "desc" })).toEqual({
      sortBy: "type",
      sortOrder: "desc",
    });
  });
});

describe("toDriveListSortQuery", () => {
  it("omitted selection does not send a sort override", () => {
    expect(toDriveListSortQuery(null)).toEqual({});
  });

  it("passes name/date/type through for Browse and Tasks primary sort", () => {
    expect(toDriveListSortQuery({ sortBy: "name", sortOrder: "desc" })).toEqual(
      { sortBy: "name", sortOrder: "desc" },
    );
    expect(toDriveListSortQuery({ sortBy: "type", sortOrder: "asc" })).toEqual({
      sortBy: "type",
      sortOrder: "asc",
    });
  });

  it("recents date selection controls activity direction", () => {
    expect(toDriveListSortQuery({ sortBy: "date", sortOrder: "asc" })).toEqual({
      sortBy: "date",
      sortOrder: "asc",
    });
  });

  it("recents never requests a non-date primary key; name/type map to Core secondary", () => {
    // Core keeps activityAt primary; sortBy=name|type is secondary only.
    expect(toDriveListSortQuery({ sortBy: "name", sortOrder: "asc" })).toEqual({
      sortBy: "name",
      sortOrder: "asc",
    });
    expect(toDriveListSortQuery({ sortBy: "type", sortOrder: "desc" })).toEqual(
      { sortBy: "type", sortOrder: "desc" },
    );
  });
});

describe("sort order helpers", () => {
  it("defaults date to desc and name/type to asc", () => {
    expect(defaultSortOrderForKey("date")).toBe("desc");
    expect(defaultSortOrderForKey("name")).toBe("asc");
    expect(defaultSortOrderForKey("type")).toBe("asc");
  });

  it("toggles asc/desc", () => {
    expect(toggleSortOrder("asc")).toBe("desc");
    expect(toggleSortOrder("desc")).toBe("asc");
  });
});
