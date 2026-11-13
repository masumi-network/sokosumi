import { afterEach, describe, expect, it } from "vitest";

import {
  getStoredTasksReturnPath,
  isTasksRootPath,
  storeTasksReturnPath,
  TASKS_RETURN_PATH_SESSION_KEY,
  TASKS_RETURN_TASK_SESSION_KEY,
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

    function openFromCalendar(calendar: string, taskPath: string) {
      window.history.replaceState(null, "", calendar);
      storeTasksReturnPath(taskPath);
    }

    it("returns the task opened from the Calendar to its view, period and filters", () => {
      openFromCalendar(
        "/calendar?date=2026-11-19&view=week&status=QUEUED",
        "/tasks/task-a",
      );

      expect(getStoredTasksReturnPath({ taskPath: "/tasks/task-a" })).toBe(
        "/calendar?date=2026-11-19&view=week&status=QUEUED",
      );
      // A page that isn't a task's own (archived, edit) stays on the board.
      expect(getStoredTasksReturnPath()).toBe("/tasks");
    });

    it("sends an unrelated task reached later back to the board", () => {
      // Calendar → task A, then a notification or pasted link opens task B.
      openFromCalendar("/calendar?view=week", "/tasks/task-a");
      window.history.replaceState(null, "", "/chat");

      expect(getStoredTasksReturnPath({ taskPath: "/tasks/task-b" })).toBe(
        "/tasks",
      );
      // A again (refresh, browser Back) still returns to the Calendar.
      expect(getStoredTasksReturnPath({ taskPath: "/tasks/task-a" })).toBe(
        "/calendar?view=week",
      );
    });

    it("forgets the Calendar once a task is opened from the board", () => {
      openFromCalendar("/calendar?view=week", "/tasks/task-a");
      window.history.replaceState(null, "", "/tasks?view=list");
      storeTasksReturnPath();

      expect(getStoredTasksReturnPath({ taskPath: "/tasks/task-a" })).toBe(
        "/tasks?view=list",
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
      window.sessionStorage.setItem(
        TASKS_RETURN_TASK_SESSION_KEY,
        "/tasks/task-a",
      );

      expect(getStoredTasksReturnPath({ taskPath: "/tasks/task-a" })).toBe(
        "/tasks",
      );
    });
  });
});
