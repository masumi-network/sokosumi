import { describe, expect, it } from "vitest";

import type { TaskWithCoworker } from "@/lib/types/task";

import { compareTasksDesc } from "../task-sort";

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
    columnId: "backlog",
    events: [],
    agents: [],
    coworker: null,
    ...overrides,
  };
}

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
