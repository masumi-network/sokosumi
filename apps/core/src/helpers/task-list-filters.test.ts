import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  applyTaskListScheduleWhere,
  applyTaskListStatusWhere,
  buildTaskListScheduleWhere,
  buildTaskListStatusWhere,
} from "./task-list-filters";

describe("buildTaskListStatusWhere", () => {
  it("returns empty filter when no params are set", () => {
    expect(buildTaskListStatusWhere({})).toEqual({});
  });

  it("filters by status list", () => {
    expect(
      buildTaskListStatusWhere({
        statuses: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP],
      }),
    ).toEqual({
      status: { in: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP] },
    });
  });

  it("filters grant-pending tasks by status", () => {
    expect(
      buildTaskListStatusWhere({
        statuses: [TaskStatus.GRANT_PENDING],
      }),
    ).toEqual({
      status: { in: [TaskStatus.GRANT_PENDING] },
    });
  });
});

describe("applyTaskListStatusWhere", () => {
  it("merges status filter into an existing where filter", () => {
    const where = {
      archivedAt: null,
      workspaceId: "ws-1",
      AND: [{ assigneeId: "cow-1" }],
    };

    expect(
      applyTaskListStatusWhere(
        where,
        buildTaskListStatusWhere({
          statuses: [TaskStatus.READY],
        }),
      ),
    ).toEqual({
      archivedAt: null,
      workspaceId: "ws-1",
      status: { in: [TaskStatus.READY] },
      AND: [{ assigneeId: "cow-1" }],
    });
  });
});

describe("buildTaskListScheduleWhere", () => {
  it("returns an empty filter when hasSchedule is undefined", () => {
    expect(buildTaskListScheduleWhere({})).toEqual({});
  });

  it("matches tasks with metadata or nextRunAt when true", () => {
    expect(buildTaskListScheduleWhere({ hasSchedule: true })).toEqual({
      OR: [{ metadata: { not: null } }, { nextRunAt: { not: null } }],
    });
  });

  it("matches tasks with neither metadata nor nextRunAt when false", () => {
    expect(buildTaskListScheduleWhere({ hasSchedule: false })).toEqual({
      AND: [{ metadata: null }, { nextRunAt: null }],
    });
  });
});

describe("applyTaskListScheduleWhere", () => {
  it("preserves the existing where filter when hasSchedule is undefined", () => {
    const where = {
      archivedAt: null,
      AND: [{ ownerId: "user-1" }],
    };

    expect(applyTaskListScheduleWhere(where, undefined)).toEqual(where);
  });

  it("adds an OR match on metadata or nextRunAt when true", () => {
    expect(
      applyTaskListScheduleWhere(
        {
          archivedAt: null,
          AND: [{ ownerId: "user-1" }],
        },
        true,
      ),
    ).toEqual({
      archivedAt: null,
      AND: [{ ownerId: "user-1" }],
      OR: [{ metadata: { not: null } }, { nextRunAt: { not: null } }],
    });
  });

  it("appends both null conditions to the existing AND when false", () => {
    expect(
      applyTaskListScheduleWhere(
        {
          archivedAt: null,
          AND: [{ ownerId: "user-1" }],
        },
        false,
      ),
    ).toEqual({
      archivedAt: null,
      AND: [{ ownerId: "user-1" }, { metadata: null }, { nextRunAt: null }],
    });
  });
});
