import { describe, expect, it } from "vitest";

import type { TaskWithCoworker } from "@/lib/types/task";

import { compareScheduledTasksAsc, compareTasksDesc } from "../task-sort";

function buildTask(
  overrides: Partial<TaskWithCoworker> & Pick<TaskWithCoworker, "id">,
): TaskWithCoworker {
  return {
    name: "Task",
    description: "Description",
    status: "QUEUED",
    userId: "user-1",
    user: { id: "user-1", name: "Test User", image: null },
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    jobsCount: 0,
    commentsCount: 0,
    columnId: "scheduled",
    events: [],
    agents: [],
    coworker: null,
    ...overrides,
  };
}

describe("compareScheduledTasksAsc", () => {
  it("orders tasks by soonest nextRunAt first", () => {
    const tasks = [
      buildTask({
        id: "later",
        nextRunAt: "2026-06-10T09:00:00.000Z",
      }),
      buildTask({
        id: "sooner",
        nextRunAt: "2026-06-08T09:00:00.000Z",
      }),
      buildTask({
        id: "middle",
        nextRunAt: "2026-06-09T09:00:00.000Z",
      }),
    ];

    expect(
      [...tasks].sort(compareScheduledTasksAsc).map((task) => task.id),
    ).toEqual(["sooner", "middle", "later"]);
  });

  it("places tasks without nextRunAt after scheduled tasks", () => {
    const tasks = [
      buildTask({ id: "missing", nextRunAt: null }),
      buildTask({
        id: "scheduled",
        nextRunAt: "2026-06-08T09:00:00.000Z",
      }),
    ];

    expect(
      [...tasks].sort(compareScheduledTasksAsc).map((task) => task.id),
    ).toEqual(["scheduled", "missing"]);
  });
});

describe("compareTasksDesc", () => {
  it("orders tasks by updatedAt descending", () => {
    const tasks = [
      buildTask({
        id: "older",
        columnId: "todo",
        updatedAt: "2026-06-01T12:00:00.000Z",
      }),
      buildTask({
        id: "newer",
        columnId: "todo",
        updatedAt: "2026-06-02T12:00:00.000Z",
      }),
    ];

    expect([...tasks].sort(compareTasksDesc).map((task) => task.id)).toEqual([
      "newer",
      "older",
    ]);
  });
});
