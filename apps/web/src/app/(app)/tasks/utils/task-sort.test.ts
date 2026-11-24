import { describe, expect, it } from "vitest";

import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

import {
  compareTasks,
  compareTasksDesc,
  effectiveTasksSort,
  parseTasksSort,
} from "./task-sort";

function buildTask(
  overrides: Partial<TaskWithCoworker> & Pick<TaskWithCoworker, "id">,
): TaskWithCoworker {
  return {
    name: "Task",
    description: "Description",
    status: "QUEUED",
    identifier: null,
    priority: "NONE",
    visibility: "PUBLIC",
    ownerId: "user-1",
    owner: { id: "user-1", name: "Test User", image: null },
    project: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    jobsCount: 0,
    commentsCount: 0,
    columnId: "backlog",
    events: [],
    agents: [],
    assignee: null,
    participants: [],
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

describe("compareTasks", () => {
  const ids = (
    sort: Parameters<typeof compareTasks>[0],
    tasks: TaskWithCoworker[],
  ) => [...tasks].sort(compareTasks(sort)).map((task) => task.id);

  it("puts urgent first and none last, then the most recently updated", () => {
    expect(
      ids("priority", [
        buildTask({ id: "none", priority: "NONE" }),
        buildTask({ id: "low", priority: "LOW" }),
        buildTask({
          id: "urgent-old",
          priority: "URGENT",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }),
        buildTask({
          id: "urgent-new",
          priority: "URGENT",
          updatedAt: "2026-06-03T00:00:00.000Z",
        }),
      ]),
    ).toEqual(["urgent-new", "urgent-old", "low", "none"]);
  });

  it("puts the earliest due day first and undated Tasks last", () => {
    expect(
      ids("dueOn", [
        buildTask({ id: "undated", dueOn: null }),
        buildTask({ id: "late", dueOn: "2026-07-10" }),
        buildTask({ id: "soon", dueOn: "2026-06-05" }),
      ]),
    ).toEqual(["soon", "late", "undated"]);
  });

  it("orders newest created first, whatever was updated last", () => {
    expect(
      ids("createdAt", [
        buildTask({
          id: "old-but-touched",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-09T00:00:00.000Z",
        }),
        buildTask({ id: "new", createdAt: "2026-06-01T00:00:00.000Z" }),
      ]),
    ).toEqual(["new", "old-but-touched"]);
  });

  it("orders oldest created first with oldest", () => {
    expect(
      ids("oldest", [
        buildTask({ id: "new", createdAt: "2026-06-01T00:00:00.000Z" }),
        buildTask({
          id: "old-but-touched",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-09T00:00:00.000Z",
        }),
      ]),
    ).toEqual(["old-but-touched", "new"]);
  });
});

describe("Sort by values", () => {
  it("accepts only Core's sort keys", () => {
    expect(parseTasksSort("priority")).toBe("priority");
    expect(parseTasksSort("name")).toBeUndefined();
  });

  it("shows each layout's own default when the reader picked none", () => {
    expect(effectiveTasksSort(undefined, "board")).toBe("updatedAt");
    expect(effectiveTasksSort(undefined, "list")).toBe("createdAt");
    expect(effectiveTasksSort("dueOn", "list")).toBe("dueOn");
  });

  it("shows Handed off oldest first on both layouts unless the reader picked an order", () => {
    expect(effectiveTasksSort(undefined, "board", "handedOff")).toBe("oldest");
    expect(effectiveTasksSort(undefined, "list", "handedOff")).toBe("oldest");
    expect(effectiveTasksSort("priority", "board", "handedOff")).toBe(
      "priority",
    );
  });
});
