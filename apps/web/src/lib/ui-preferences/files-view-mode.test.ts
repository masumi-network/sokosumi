import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILES_VIEW_MODE,
  effectiveFilesViewMode,
  FILES_VIEW_MODE_COOKIE_MAX_AGE,
  FILES_VIEW_MODE_COOKIE_NAME,
  parseFilesViewMode,
  parseFilesViewModeCookieHeader,
  resolveFilesViewModeFromClientCookie,
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

describe("parseFilesViewModeCookieHeader", () => {
  it("reads files_view_mode from a cookie header", () => {
    expect(
      parseFilesViewModeCookieHeader(
        `other=1; ${FILES_VIEW_MODE_COOKIE_NAME}=grid; theme=dark`,
      ),
    ).toBe("grid");
    expect(
      parseFilesViewModeCookieHeader(`${FILES_VIEW_MODE_COOKIE_NAME}=list`),
    ).toBe("list");
  });

  it("returns null when missing or invalid", () => {
    expect(parseFilesViewModeCookieHeader("theme=dark")).toBeNull();
    expect(
      parseFilesViewModeCookieHeader(`${FILES_VIEW_MODE_COOKIE_NAME}=board`),
    ).toBeNull();
  });
});

describe("resolveFilesViewModeFromClientCookie", () => {
  it("prefers cookie when present", () => {
    expect(
      resolveFilesViewModeFromClientCookie(
        `${FILES_VIEW_MODE_COOKIE_NAME}=grid`,
      ),
    ).toBe("grid");
    expect(
      resolveFilesViewModeFromClientCookie(
        `${FILES_VIEW_MODE_COOKIE_NAME}=list`,
      ),
    ).toBe("list");
  });

  it("defaults to list when cookie is missing", () => {
    expect(resolveFilesViewModeFromClientCookie("")).toBe(
      DEFAULT_FILES_VIEW_MODE,
    );
    expect(resolveFilesViewModeFromClientCookie("theme=dark")).toBe("list");
  });
});
