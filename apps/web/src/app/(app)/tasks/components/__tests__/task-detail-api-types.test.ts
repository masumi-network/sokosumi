import { describe, expect, it } from "vitest";

import {
  getTaskLinkActionInput,
  isTaskArchivableStatus,
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

  it.each([
    TASK_STATUS.DRAFT,
    TASK_STATUS.READY,
    TASK_STATUS.CANCELED,
    TASK_STATUS.COMPLETED,
    TASK_STATUS.FAILED,
  ] as const)("isTaskArchivableStatus returns true for %s", (status) => {
    expect(isTaskArchivableStatus(status)).toBe(true);
  });

  it.each([
    TASK_STATUS.INPUT_REQUIRED,
    TASK_STATUS.AUTHENTICATION_REQUIRED,
    TASK_STATUS.OUT_OF_CREDITS,
    TASK_STATUS.CREDITS_TOPPED_UP,
    TASK_STATUS.RUNNING,
    TASK_STATUS.AWAITING_EXTERNAL,
    TASK_STATUS.CANCEL_REQUESTED,
  ] as const)("isTaskArchivableStatus returns false for %s", (status) => {
    expect(isTaskArchivableStatus(status)).toBe(false);
  });
});
