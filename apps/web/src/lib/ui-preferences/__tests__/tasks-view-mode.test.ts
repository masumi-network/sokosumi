import {
  parseTasksViewMode,
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

describe("serializeTasksViewModeCookie", () => {
  it("serializes cookie with name, value, path, and max-age", () => {
    expect(serializeTasksViewModeCookie("list")).toBe(
      `${TASKS_VIEW_MODE_COOKIE_NAME}=list; path=/; max-age=${TASKS_VIEW_MODE_COOKIE_MAX_AGE}`,
    );
  });
});
