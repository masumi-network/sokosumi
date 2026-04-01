import { describe, expect, it } from "vitest";

import {
  getTaskLinkActionInput,
  mapVisibleTaskLinks,
  TASK_STATUS,
} from "@/app/tasks/components/task-detail-api-types";
import { TaskLinkRelation } from "@/lib/clients/generated/core/types.gen";

describe("task-detail-api-types", () => {
  it("maps task link relations to action inputs", () => {
    expect(getTaskLinkActionInput(TaskLinkRelation.RELATED)).toEqual({
      type: "RELATES",
      direction: "outgoing",
    });
    expect(getTaskLinkActionInput(TaskLinkRelation.CHILD)).toEqual({
      type: "PARENT",
      direction: "incoming",
    });
  });

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
          status: TASK_STATUS.READY,
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
          status: TASK_STATUS.CANCELED,
          archivedAt: new Date("2026-03-31T10:00:00.000Z"),
        },
      },
    ]);

    expect(result).toEqual([
      {
        id: "task-2",
        name: "Visible task",
        status: TASK_STATUS.READY,
        relation: TaskLinkRelation.RELATED,
      },
    ]);
  });
});
