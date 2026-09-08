import { describe, expect, it } from "vitest";

import {
  applyTasksTabSearchParam,
  DEFAULT_TASKS_TAB,
  parseTasksTab,
  TASKS_TAB_PARAM,
} from "@/app/tasks/utils/tasks-tab";

describe("parseTasksTab", () => {
  it("returns jobs when tab=jobs", () => {
    expect(parseTasksTab("jobs")).toBe("jobs");
  });

  it("defaults to tasks for missing or unknown values", () => {
    expect(parseTasksTab(undefined)).toBe(DEFAULT_TASKS_TAB);
    expect(parseTasksTab("tasks")).toBe(DEFAULT_TASKS_TAB);
    expect(parseTasksTab("other")).toBe(DEFAULT_TASKS_TAB);
    expect(parseTasksTab(["jobs"])).toBe("jobs");
  });
});

describe("applyTasksTabSearchParam", () => {
  it("sets tab=jobs while preserving other params", () => {
    const next = applyTasksTabSearchParam(
      new URLSearchParams("projectId=abc&status=RUNNING"),
      "jobs",
    );

    expect(next.get("projectId")).toBe("abc");
    expect(next.get("status")).toBe("RUNNING");
    expect(next.get(TASKS_TAB_PARAM)).toBe("jobs");
  });

  it("sets tab=tasks when switching back from jobs", () => {
    const next = applyTasksTabSearchParam(
      new URLSearchParams("projectId=abc&tab=jobs"),
      "tasks",
    );

    expect(next.get("projectId")).toBe("abc");
    expect(next.get(TASKS_TAB_PARAM)).toBe("tasks");
  });
});
