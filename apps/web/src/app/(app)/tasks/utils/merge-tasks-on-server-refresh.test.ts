import { describe, expect, it } from "vitest";
import { TaskStatus } from "@/lib/clients/generated/core";

import { mergeTasksOnServerRefresh } from "./merge-tasks-on-server-refresh";

function buildTask(
  id: string,
  overrides: Partial<{ status: TaskStatus; name: string }> = {},
) {
  return {
    id,
    name: overrides.name ?? `Task ${id}`,
    status: overrides.status ?? TaskStatus.READY,
    ownerId: "user-1",
    owner: { id: "user-1", name: "Test User", image: null },
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    jobsCount: 0,
    commentsCount: 0,
    columnId: "todo" as const,
    events: [],
    agents: [],
  };
}

describe("mergeTasksOnServerRefresh", () => {
  it("keeps client-only load-more rows on board refresh", () => {
    const prev = [
      buildTask("task-1"),
      buildTask("task-2"),
      buildTask("task-3"),
    ];
    const serverTasks = [
      buildTask("task-1", { name: "Updated 1" }),
      buildTask("task-2", { name: "Updated 2" }),
    ];

    const next = mergeTasksOnServerRefresh({
      prev,
      serverTasks,
      pendingMoveTaskIds: new Set(),
      keepLocalOnlyTasks: true,
    });

    expect(next.map((task) => task.id)).toEqual(["task-1", "task-2", "task-3"]);
    expect(next[0]?.name).toBe("Updated 1");
    expect(next.length > serverTasks.length).toBe(true);
  });

  it("drops client-only load-more rows on list refresh so pagination can resync", () => {
    const prev = [
      buildTask("task-1"),
      buildTask("task-2"),
      buildTask("task-3"),
    ];
    const serverTasks = [
      buildTask("task-1", { name: "Updated 1" }),
      buildTask("task-2", { name: "Updated 2" }),
    ];

    const next = mergeTasksOnServerRefresh({
      prev,
      serverTasks,
      pendingMoveTaskIds: new Set(),
      keepLocalOnlyTasks: false,
    });

    expect(next.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    expect(next[0]?.name).toBe("Updated 1");
    expect(next.length <= serverTasks.length).toBe(true);
  });

  it("preserves local optimistic status while a move is pending", () => {
    const prev = [
      buildTask("task-1", { status: TaskStatus.RUNNING, name: "Local" }),
    ];
    const serverTasks = [
      buildTask("task-1", { status: TaskStatus.READY, name: "Server" }),
    ];

    const next = mergeTasksOnServerRefresh({
      prev,
      serverTasks,
      pendingMoveTaskIds: new Set(["task-1"]),
      keepLocalOnlyTasks: false,
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.status).toBe(TaskStatus.RUNNING);
    expect(next[0]?.name).toBe("Local");
  });
});
