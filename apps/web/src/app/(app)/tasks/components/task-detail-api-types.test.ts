import { TaskLinkRelation, TaskStatus } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { mapVisibleTaskLinks } from "@/app/tasks/components/task-detail-api-types";

describe("task-detail-api-types", () => {
  it("filters archived peer tasks from visible linked tasks", () => {
    const result = mapVisibleTaskLinks([
      {
        id: "link-1",
        createdAt: new Date("2026-03-31T10:00:00.000Z"),
        updatedAt: new Date("2026-03-31T10:00:00.000Z"),
        relation: TaskLinkRelation.RELATED,
        note: null,
        peerTask: {
          id: "task-2",
          name: "Visible task",
          status: TaskStatus.READY,
          archivedAt: null,
          identifier: "SOK-2",
        },
      },
      {
        id: "link-2",
        createdAt: new Date("2026-03-31T10:00:00.000Z"),
        updatedAt: new Date("2026-03-31T10:00:00.000Z"),
        relation: TaskLinkRelation.BLOCKED_BY,
        note: null,
        peerTask: {
          id: "task-3",
          name: "Archived task",
          status: TaskStatus.CANCELED,
          archivedAt: new Date("2026-03-31T10:00:00.000Z"),
          identifier: null,
        },
      },
    ]);

    expect(result).toEqual([
      {
        id: "task-2",
        name: "Visible task",
        identifier: "SOK-2",
        status: TaskStatus.READY,
        relation: TaskLinkRelation.RELATED,
      },
    ]);
  });

  it("shows a Markdown peer name as plain text", () => {
    const result = mapVisibleTaskLinks([
      {
        id: "link-1",
        createdAt: new Date("2026-03-31T10:00:00.000Z"),
        updatedAt: new Date("2026-03-31T10:00:00.000Z"),
        relation: TaskLinkRelation.RELATED,
        note: null,
        peerTask: {
          id: "task-2",
          name: "**Task Name:** _Weekly_",
          status: TaskStatus.READY,
          archivedAt: null,
          identifier: null,
        },
      },
    ]);

    expect(result[0]?.name).toBe("Task Name: Weekly");
  });
});
