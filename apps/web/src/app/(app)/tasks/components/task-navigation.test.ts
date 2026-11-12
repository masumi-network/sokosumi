import { afterEach, describe, expect, it } from "vitest";

import {
  getStoredTasksReturnPath,
  isTasksRootPath,
  storeTasksReturnPath,
  TASKS_RETURN_PATH_SESSION_KEY,
} from "@/app/tasks/components/task-navigation";

describe("task-navigation", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("treats only exact /tasks as the list root", () => {
    expect(isTasksRootPath("/tasks")).toBe(true);
    expect(isTasksRootPath("/tasks/t1")).toBe(false);
  });

  it("returns /tasks when nothing valid is stored", () => {
    expect(getStoredTasksReturnPath()).toBe("/tasks");
    window.sessionStorage.setItem(TASKS_RETURN_PATH_SESSION_KEY, "/agents");
    expect(getStoredTasksReturnPath()).toBe("/tasks");
  });

  it("returns the stored tasks list path with query", () => {
    window.sessionStorage.setItem(
      TASKS_RETURN_PATH_SESSION_KEY,
      "/tasks?view=list&status=todo",
    );
    expect(getStoredTasksReturnPath()).toBe("/tasks?view=list&status=todo");
  });

  describe("Calendar return", () => {
    afterEach(() => {
      window.history.replaceState(null, "", "/");
    });

    it("stores the Calendar with its view, period and filters", () => {
      window.history.replaceState(
        null,
        "",
        "/calendar?date=2026-11-19&view=week&status=QUEUED",
      );
      storeTasksReturnPath();

      expect(getStoredTasksReturnPath({ allowCalendar: true })).toBe(
        "/calendar?date=2026-11-19&view=week&status=QUEUED",
      );
    });

    it("returns the Calendar only where a page allows it", () => {
      window.sessionStorage.setItem(
        TASKS_RETURN_PATH_SESSION_KEY,
        "/calendar?view=month",
      );

      expect(getStoredTasksReturnPath()).toBe("/tasks");
      expect(getStoredTasksReturnPath({ allowCalendar: true })).toBe(
        "/calendar?view=month",
      );
    });

    it.each([
      "//evil.example/calendar",
      "/calendarx",
      "/calendar/../admin",
      "/tasksx",
      "https://evil.example/tasks",
    ])("ignores %s", (stored) => {
      window.sessionStorage.setItem(TASKS_RETURN_PATH_SESSION_KEY, stored);

      expect(getStoredTasksReturnPath({ allowCalendar: true })).toBe("/tasks");
    });
  });
});
