import { describe, expect, it } from "vitest";

import { mapVisibleTaskLinks } from "@/app/tasks/components/task-detail-api-types";
import { TaskLinkRelation, TaskStatus } from "@/lib/clients/generated/core";

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
        },
      },
    ]);

    expect(result).toEqual([
      {
        id: "task-2",
        name: "Visible task",
        status: TaskStatus.READY,
        relation: TaskLinkRelation.RELATED,
      },
    ]);
  });
});
