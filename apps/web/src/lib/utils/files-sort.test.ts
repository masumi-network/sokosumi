import { describe, expect, it } from "vitest";
import {
  defaultSortOrderForKey,
  effectiveFilesSortSelection,
  FILES_SORT_OMIT_DEFAULTS,
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
  it("uses Browse omit default (name asc) when selection is null", () => {
    expect(effectiveFilesSortSelection(null, "browse")).toEqual(
      FILES_SORT_OMIT_DEFAULTS.browse,
    );
  });

  it("uses Tasks omit default (date desc) when selection is null", () => {
    expect(effectiveFilesSortSelection(null, "tasks")).toEqual(
      FILES_SORT_OMIT_DEFAULTS.tasks,
    );
  });

  it("Browse collapses name ascending to omit; keeps date descending explicit", () => {
    expect(
      toStoredFilesSortSelection(
        { sortBy: "name", sortOrder: "asc" },
        "browse",
      ),
    ).toBeNull();
    expect(
      toStoredFilesSortSelection(
        { sortBy: "date", sortOrder: "desc" },
        "browse",
      ),
    ).toEqual({ sortBy: "date", sortOrder: "desc" });
    expect(
      toStoredFilesSortSelection(
        { sortBy: "name", sortOrder: "desc" },
        "browse",
      ),
    ).toEqual({ sortBy: "name", sortOrder: "desc" });
  });

  it("Tasks collapses date descending to omit; keeps name ascending explicit", () => {
    expect(
      toStoredFilesSortSelection(
        { sortBy: "date", sortOrder: "desc" },
        "tasks",
      ),
    ).toBeNull();
    expect(
      toStoredFilesSortSelection({ sortBy: "name", sortOrder: "asc" }, "tasks"),
    ).toEqual({ sortBy: "name", sortOrder: "asc" });
    expect(
      toStoredFilesSortSelection({ sortBy: "date", sortOrder: "asc" }, "tasks"),
    ).toEqual({ sortBy: "date", sortOrder: "asc" });
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
    expect(toDriveListSortQuery({ sortBy: "date", sortOrder: "asc" })).toEqual({
      sortBy: "date",
      sortOrder: "asc",
    });
    expect(toDriveListSortQuery({ sortBy: "type", sortOrder: "asc" })).toEqual({
      sortBy: "type",
      sortOrder: "asc",
    });
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
