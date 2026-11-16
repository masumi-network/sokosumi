import { describe, expect, it } from "vitest";

import {
  effectiveFilesViewMode,
  FILES_VIEW_MODE_COOKIE_MAX_AGE,
  FILES_VIEW_MODE_COOKIE_NAME,
  parseFilesViewMode,
  serializeFilesViewModeCookie,
} from "@/lib/ui-preferences/files-view-mode";

describe("parseFilesViewMode", () => {
  it("returns list for list", () => {
    expect(parseFilesViewMode("list")).toBe("list");
  });

  it("returns grid for grid", () => {
    expect(parseFilesViewMode("grid")).toBe("grid");
  });

  it("returns null for invalid values", () => {
    expect(parseFilesViewMode("board")).toBeNull();
    expect(parseFilesViewMode("")).toBeNull();
    expect(parseFilesViewMode(null)).toBeNull();
    expect(parseFilesViewMode(undefined)).toBeNull();
  });
});

describe("effectiveFilesViewMode", () => {
  it("forces list on mobile regardless of preference", () => {
    expect(effectiveFilesViewMode("grid", true)).toBe("list");
    expect(effectiveFilesViewMode("list", true)).toBe("list");
  });

  it("keeps the preference on desktop", () => {
    expect(effectiveFilesViewMode("grid", false)).toBe("grid");
    expect(effectiveFilesViewMode("list", false)).toBe("list");
  });
});

describe("serializeFilesViewModeCookie", () => {
  it("serializes cookie with name, value, path, and max-age", () => {
    expect(serializeFilesViewModeCookie("grid")).toBe(
      `${FILES_VIEW_MODE_COOKIE_NAME}=grid; path=/; max-age=${FILES_VIEW_MODE_COOKIE_MAX_AGE}`,
    );
  });
});
