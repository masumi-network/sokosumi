import { HistoryKind, JobType, TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";
import { describe, expect, it, vi } from "vitest";

import {
  buildHistoryArchivedFilter,
  buildHistoryStatusFilter,
  type HistoryRowForApi,
  mapHistoryRow,
} from "./history";

function createHistoryRow(
  overrides: Partial<HistoryRowForApi> = {},
): HistoryRowForApi {
  return {
    agentId: "agent_123",
    bucketSlug: null,
    coworkerId: null,
    creditsCents: 25_000_000_000n,
    description: null,
    entityId: "job_123",
    id: "history_123",
    kind: HistoryKind.JOB,
    projectId: null,
    sortAt: new Date("2026-04-02T10:00:00.000Z"),
    status: SokosumiJobStatus.PAYMENT_PENDING,
    title: "Timed out job",
    ...overrides,
  };
}

describe("mapHistoryRow", () => {
  it("overlays computed job status when provided", () => {
    const row = createHistoryRow({
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });

    const item = mapHistoryRow(row, {
      jobStatusByEntityId: new Map([
        [row.entityId, SokosumiJobStatus.PAYMENT_FAILED],
      ]),
    });

    expect(item).toMatchObject({
      kind: "job",
      id: row.entityId,
      status: SokosumiJobStatus.PAYMENT_FAILED,
    });
  });

  it("keeps stored job status when no computed override exists", () => {
    const row = createHistoryRow({
      status: SokosumiJobStatus.PROCESSING,
    });

    const item = mapHistoryRow(row, {
      jobStatusByEntityId: new Map(),
    });

    expect(item).toMatchObject({
      kind: "job",
      status: SokosumiJobStatus.PROCESSING,
    });
  });

  it("does not apply job status overrides to task rows", () => {
    const row = createHistoryRow({
      entityId: "task_123",
      kind: HistoryKind.TASK,
      status: TaskStatus.READY,
    });

    const item = mapHistoryRow(row, {
      jobStatusByEntityId: new Map([["task_123", SokosumiJobStatus.FAILED]]),
    });

    expect(item).toMatchObject({
      kind: "task",
      status: TaskStatus.READY,
    });
  });
});

describe("buildHistoryArchivedFilter", () => {
  it("excludes archived rows by default", () => {
    expect(buildHistoryArchivedFilter(undefined)).toEqual({
      archivedAt: null,
    });
  });

  it("excludes archived rows when status filter omits archived", () => {
    expect(buildHistoryArchivedFilter(["active", "READY"])).toEqual({
      archivedAt: null,
    });
  });

  it("skips the global archived filter when status filter includes archived", () => {
    expect(buildHistoryArchivedFilter(["archived"])).toBeNull();
    expect(buildHistoryArchivedFilter(["active", "archived"])).toBeNull();
  });
});

describe("buildHistoryStatusFilter", () => {
  it("matches non-archived task and conversation rows on stored status", () => {
    expect(
      buildHistoryStatusFilter(
        [TaskStatus.READY, "active"],
        [HistoryKind.TASK, HistoryKind.CONVERSATION],
        [],
      ),
    ).toEqual({
      OR: [
        {
          kind: HistoryKind.TASK,
          status: { in: [TaskStatus.READY] },
          archivedAt: null,
        },
        {
          kind: HistoryKind.CONVERSATION,
          archivedAt: null,
        },
      ],
    });
  });

  it("matches archived tasks and conversations using archivedAt", () => {
    expect(
      buildHistoryStatusFilter(
        ["archived"],
        [HistoryKind.TASK, HistoryKind.CONVERSATION],
        [],
      ),
    ).toEqual({
      OR: [
        {
          kind: HistoryKind.TASK,
          archivedAt: { not: null },
        },
        {
          kind: HistoryKind.CONVERSATION,
          archivedAt: { not: null },
        },
      ],
    });
  });

  it("includes both archived and non-archived rows when active and archived are requested", () => {
    expect(
      buildHistoryStatusFilter(
        ["active", "archived"],
        [HistoryKind.TASK, HistoryKind.CONVERSATION],
        [],
      ),
    ).toEqual({
      OR: [
        {
          OR: [
            {
              kind: HistoryKind.TASK,
              archivedAt: null,
            },
            {
              kind: HistoryKind.TASK,
              archivedAt: { not: null },
            },
          ],
        },
        {
          OR: [
            {
              kind: HistoryKind.CONVERSATION,
              archivedAt: null,
            },
            {
              kind: HistoryKind.CONVERSATION,
              archivedAt: { not: null },
            },
          ],
        },
      ],
    });
  });

  it("matches job rows by computed-status entity ids", () => {
    expect(
      buildHistoryStatusFilter(
        [SokosumiJobStatus.PAYMENT_FAILED],
        [HistoryKind.JOB],
        ["job_1", "job_2"],
      ),
    ).toEqual({
      OR: [
        {
          kind: HistoryKind.JOB,
          entityId: { in: ["job_1", "job_2"] },
        },
      ],
    });
  });

  it("excludes all job rows when no computed matches exist", () => {
    expect(
      buildHistoryStatusFilter(
        [SokosumiJobStatus.PAYMENT_FAILED],
        [HistoryKind.TASK, HistoryKind.JOB],
        [],
      ),
    ).toEqual({
      OR: [
        {
          kind: HistoryKind.TASK,
          status: { in: [SokosumiJobStatus.PAYMENT_FAILED] },
          archivedAt: null,
        },
        {
          kind: HistoryKind.JOB,
          entityId: { in: [] },
        },
      ],
    });
  });
});

describe("findJobHistoryEntityIdsMatchingStatuses", () => {
  it("queries computed job status in SQL", async () => {
    const queryRawMock = vi.fn().mockResolvedValue([{ entityId: "job_123" }]);
    const { findJobHistoryEntityIdsMatchingStatuses } = await import(
      "./history"
    );

    const entityIds = await findJobHistoryEntityIdsMatchingStatuses(
      {
        projectId: null,
        scope: "owned",
        statuses: [SokosumiJobStatus.PAYMENT_FAILED],
        types: [HistoryKind.JOB],
        userContext: {
          userId: "user_123",
          organizationId: "org_123",
          role: "user",
        },
        workspaceContext: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: null,
          organizationId: "org_123",
        },
      },
      { $queryRaw: queryRawMock, job: { findMany: vi.fn() } },
    );

    expect(entityIds).toEqual(["job_123"]);
    expect(queryRawMock).toHaveBeenCalledOnce();
  });
});

describe("loadComputedJobStatusByEntityId", () => {
  it("returns computed statuses keyed by job id", async () => {
    const payByTime = new Date(Date.now() - 11 * 60 * 1000);
    const findManyMock = vi.fn().mockResolvedValue([
      {
        createdAt: payByTime,
        events: [],
        externalDisputeUnlockTime: null,
        jobType: JobType.PAID,
        payByTime,
        projectId: null,
        purchase: null,
        refundedTransactionId: null,
        submitResultTime: null,
        id: "job_123",
      },
    ]);
    const { loadComputedJobStatusByEntityId } = await import("./history");

    const statuses = await loadComputedJobStatusByEntityId(["job_123"], {
      $queryRaw: vi.fn(),
      job: { findMany: findManyMock },
    });

    expect(findManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["job_123"] } },
      select: expect.objectContaining({
        jobType: true,
        payByTime: true,
        purchase: true,
      }),
    });
    expect(statuses.get("job_123")).toBe(SokosumiJobStatus.PAYMENT_FAILED);
  });
});
