import { describe, expect, it } from "vitest";
import {
  parseTasksViewMode,
  preferTasksListFromDeviceType,
  resolveDefaultTasksViewMode,
  serializeTasksViewModeCookie,
  TASKS_VIEW_MODE_COOKIE_MAX_AGE,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";

describe("parseTasksViewMode", () => {
  it("returns board for board", () => {
    expect(parseTasksViewMode("board")).toBe("board");
  });

  it("returns list for list", () => {
    expect(parseTasksViewMode("list")).toBe("list");
  });

  it("returns null for invalid values", () => {
    expect(parseTasksViewMode("grid")).toBeNull();
    expect(parseTasksViewMode("")).toBeNull();
    expect(parseTasksViewMode(null)).toBeNull();
    expect(parseTasksViewMode(undefined)).toBeNull();
  });
});

describe("preferTasksListFromDeviceType", () => {
  it("returns true for mobile and tablet", () => {
    expect(preferTasksListFromDeviceType("mobile")).toBe(true);
    expect(preferTasksListFromDeviceType("tablet")).toBe(true);
  });

  it("returns false for desktop and unknown", () => {
    expect(preferTasksListFromDeviceType(undefined)).toBe(false);
    expect(preferTasksListFromDeviceType("")).toBe(false);
    expect(preferTasksListFromDeviceType("console")).toBe(false);
  });
});

describe("resolveDefaultTasksViewMode", () => {
  it("prefers persisted cookie over device default", () => {
    expect(
      resolveDefaultTasksViewMode({
        persisted: "board",
        preferList: true,
      }),
    ).toBe("board");
    expect(
      resolveDefaultTasksViewMode({
        persisted: "list",
        preferList: false,
      }),
    ).toBe("list");
  });

  it("defaults to list on mobile when no cookie", () => {
    expect(
      resolveDefaultTasksViewMode({
        persisted: null,
        preferList: true,
      }),
    ).toBe("list");
  });

  it("defaults to board on desktop when no cookie", () => {
    expect(
      resolveDefaultTasksViewMode({
        persisted: null,
        preferList: false,
      }),
    ).toBe("board");
  });
});

describe("serializeTasksViewModeCookie", () => {
  it("serializes cookie with name, value, path, and max-age", () => {
    expect(serializeTasksViewModeCookie("list")).toBe(
      `${TASKS_VIEW_MODE_COOKIE_NAME}=list; path=/; max-age=${TASKS_VIEW_MODE_COOKIE_MAX_AGE}`,
    );
  });
});
