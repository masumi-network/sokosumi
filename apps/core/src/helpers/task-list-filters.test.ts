import { TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  applyTaskListStatusWhere,
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
      AND: [{ coworkerId: "cow-1" }],
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
      AND: [{ coworkerId: "cow-1" }],
    });
  });
});
