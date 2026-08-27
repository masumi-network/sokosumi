import { afterEach, describe, expect, it } from "vitest";

import {
  getStoredTasksReturnPath,
  isTasksRootPath,
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
});
