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

  it("filters todo column tasks without pending grants", () => {
    expect(
      buildTaskListStatusWhere({
        statuses: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP],
        pendingApproval: false,
      }),
    ).toEqual({
      status: { in: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP] },
      pendingVendorGrantId: null,
    });
  });

  it("filters parked READY tasks for input-required status filter", () => {
    expect(
      buildTaskListStatusWhere({
        statuses: [TaskStatus.READY],
        pendingApproval: true,
      }),
    ).toEqual({
      status: { in: [TaskStatus.READY] },
      pendingVendorGrantId: { not: null },
    });
  });

  it("includes parked READY tasks alongside native input-required statuses", () => {
    expect(
      buildTaskListStatusWhere({
        statuses: [
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.APPROVAL_REQUIRED,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.OUT_OF_CREDITS,
        ],
        includeParkedReady: true,
      }),
    ).toEqual({
      AND: [
        {
          OR: [
            {
              status: {
                in: [
                  TaskStatus.INPUT_REQUIRED,
                  TaskStatus.APPROVAL_REQUIRED,
                  TaskStatus.AUTHENTICATION_REQUIRED,
                  TaskStatus.OUT_OF_CREDITS,
                ],
              },
            },
            {
              status: TaskStatus.READY,
              pendingVendorGrantId: { not: null },
            },
          ],
        },
      ],
    });
  });
});

describe("applyTaskListStatusWhere", () => {
  it("merges status AND clauses into an existing where filter", () => {
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
          pendingApproval: false,
        }),
      ),
    ).toEqual({
      archivedAt: null,
      workspaceId: "ws-1",
      status: { in: [TaskStatus.READY] },
      pendingVendorGrantId: null,
      AND: [{ coworkerId: "cow-1" }],
    });
  });
});
