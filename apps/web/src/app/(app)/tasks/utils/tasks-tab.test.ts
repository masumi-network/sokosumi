import { describe, expect, it } from "vitest";
import {
  applyTasksTabSearchParam,
  DEFAULT_TASKS_TAB,
  parseTasksTab,
  TASKS_TAB_PARAM,
} from "./tasks-tab";

describe("parseTasksTab", () => {
  it("returns calendar when tab=calendar", () => {
    expect(parseTasksTab("calendar")).toBe("calendar");
  });

  it("falls back for retired jobs and unknown values", () => {
    expect(parseTasksTab("jobs")).toBe(DEFAULT_TASKS_TAB);
    expect(parseTasksTab("schedules")).toBe(DEFAULT_TASKS_TAB);
  });

  it("defaults to tasks", () => {
    expect(parseTasksTab(undefined)).toBe(DEFAULT_TASKS_TAB);
    expect(parseTasksTab("tasks")).toBe(DEFAULT_TASKS_TAB);
    expect(parseTasksTab("other")).toBe(DEFAULT_TASKS_TAB);
    expect(parseTasksTab(["calendar"])).toBe("calendar");
  });
});

describe("applyTasksTabSearchParam", () => {
  it("sets tab=calendar while preserving other params", () => {
    const next = applyTasksTabSearchParam(
      new URLSearchParams("projectId=abc"),
      "calendar",
    );

    expect(next.get("projectId")).toBe("abc");
    expect(next.get(TASKS_TAB_PARAM)).toBe("calendar");
  });

  it("sets tab=tasks when switching back from calendar", () => {
    const next = applyTasksTabSearchParam(
      new URLSearchParams("projectId=abc&tab=calendar"),
      "tasks",
    );

    expect(next.get("projectId")).toBe("abc");
    expect(next.get(TASKS_TAB_PARAM)).toBe("tasks");
  });
});
