import { describe, expect, it } from "vitest";

import { mapVisibleTaskLinks } from "@/app/tasks/components/task-detail-api-types";
import { TaskLinkRelation, TaskStatus } from "@/lib/clients/generated/core";

function link(
  id: string,
  relation: (typeof TaskLinkRelation)[keyof typeof TaskLinkRelation],
  peerTask: {
    id: string;
    name: string;
    status: (typeof TaskStatus)[keyof typeof TaskStatus];
    archivedAt: Date | null;
  },
) {
  return {
    id,
    createdAt: new Date("2026-03-31T10:00:00.000Z"),
    updatedAt: new Date("2026-03-31T10:00:00.000Z"),
    relation,
    note: null,
    peerTask,
  };
}

const links = [
  link("link-1", TaskLinkRelation.RELATED, {
    id: "task-2",
    name: "Visible task",
    status: TaskStatus.READY,
    archivedAt: null,
  }),
  link("link-2", TaskLinkRelation.BLOCKED_BY, {
    id: "task-3",
    name: "Archived task",
    status: TaskStatus.CANCELED,
    archivedAt: new Date("2026-03-31T10:00:00.000Z"),
  }),
  link("link-3", TaskLinkRelation.SCHEDULE_RUN, {
    id: "task-4",
    name: "Released run",
    status: TaskStatus.COMPLETED,
    archivedAt: null,
  }),
  link("link-4", TaskLinkRelation.SCHEDULE_SERIES, {
    id: "task-5",
    name: "Series template",
    status: TaskStatus.QUEUED,
    archivedAt: null,
  }),
];

describe("task-detail-api-types", () => {
  it("keeps schedule runs and filters archived peers by default", () => {
    expect(mapVisibleTaskLinks(links)).toEqual([
      {
        id: "task-2",
        name: "Visible task",
        status: TaskStatus.READY,
        relation: TaskLinkRelation.RELATED,
      },
      {
        id: "task-4",
        name: "Released run",
        status: TaskStatus.COMPLETED,
        relation: TaskLinkRelation.SCHEDULE_RUN,
      },
      {
        id: "task-5",
        name: "Series template",
        status: TaskStatus.QUEUED,
        relation: TaskLinkRelation.SCHEDULE_SERIES,
      },
    ]);
  });

  it("hides schedule runs for beta viewers while keeping the series backlink", () => {
    expect(mapVisibleTaskLinks(links, { hideScheduleRuns: true })).toEqual([
      {
        id: "task-2",
        name: "Visible task",
        status: TaskStatus.READY,
        relation: TaskLinkRelation.RELATED,
      },
      {
        id: "task-5",
        name: "Series template",
        status: TaskStatus.QUEUED,
        relation: TaskLinkRelation.SCHEDULE_SERIES,
      },
    ]);
  });
});
