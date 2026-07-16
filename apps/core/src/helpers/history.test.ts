import { HistoryKind, JobType, TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

import type prisma from "@/lib/db/prisma";
import type { UserAuthenticationContext } from "@/middleware/auth";

import {
  buildHistoryArchivedFilter,
  buildHistoryStatusFilter,
  type HistoryRowForApi,
  mapHistoryRow,
} from "./history";

type HistoryPrismaClient = Pick<typeof prisma, "$queryRaw" | "job">;

const orgAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

function createHistoryPrismaClient(
  overrides: {
    $queryRaw?: HistoryPrismaClient["$queryRaw"];
    job?: Pick<HistoryPrismaClient["job"], "findMany">;
  } = {},
): HistoryPrismaClient {
  return {
    $queryRaw: vi.fn(),
    job: { findMany: vi.fn() },
    ...overrides,
  } as unknown as HistoryPrismaClient;
}

function createHistoryRow(
  overrides: Partial<HistoryRowForApi> = {},
): HistoryRowForApi {
  return {
    agentId: "agent_123",
    amount: 25_000_000_000n,
    archivedAt: null,
    bucketSlug: null,
    coworkerId: null,
    description: null,
    entityId: "job_123",
    id: "history_123",
    kind: HistoryKind.JOB,
    projectId: null,
    sortAt: new Date("2026-04-02T10:00:00.000Z"),
    status: SokosumiJobStatus.PAYMENT_PENDING,
    title: "Timed out job",
    userId: "user_123",
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

  it("maps archivedAt for archived task rows", () => {
    const archivedAt = new Date("2026-04-03T10:00:00.000Z");
    const row = createHistoryRow({
      archivedAt,
      entityId: "task_123",
      kind: HistoryKind.TASK,
      status: TaskStatus.COMPLETED,
    });

    const item = mapHistoryRow(row);

    expect(item).toMatchObject({
      kind: "task",
      archivedAt: archivedAt.toISOString(),
    });
  });

  it("maps archivedAt for archived conversation rows", () => {
    const archivedAt = new Date("2026-04-03T11:00:00.000Z");
    const row = createHistoryRow({
      archivedAt,
      bucketSlug: "hannah",
      entityId: "11111111-1111-4111-8111-111111111111",
      kind: HistoryKind.CONVERSATION,
      status: "archived",
    });

    const item = mapHistoryRow(row);

    expect(item).toMatchObject({
      kind: "conversation",
      archivedAt: archivedAt.toISOString(),
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
  it("does not include conversations when status filter uses kind-specific values only", () => {
    expect(
      buildHistoryStatusFilter(
        [TaskStatus.READY],
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
      ],
    });
  });

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
          kind: HistoryKind.JOB,
          entityId: { in: [] },
        },
      ],
    });
  });

  it("excludes task and job rows when active is the only status filter", () => {
    expect(
      buildHistoryStatusFilter(
        ["active"],
        [HistoryKind.TASK, HistoryKind.JOB],
        undefined,
      ),
    ).toEqual({
      id: { in: [] },
    });
  });

  it("maps lowercase job-style completed to task COMPLETED", () => {
    expect(
      buildHistoryStatusFilter(
        [SokosumiJobStatus.COMPLETED],
        [HistoryKind.TASK],
        [],
      ),
    ).toEqual({
      OR: [
        {
          kind: HistoryKind.TASK,
          status: { in: [TaskStatus.COMPLETED] },
          archivedAt: null,
        },
      ],
    });
  });

  it("matches READY tasks and completed jobs from mixed status query", () => {
    expect(
      buildHistoryStatusFilter(
        [TaskStatus.READY, SokosumiJobStatus.COMPLETED],
        [HistoryKind.TASK, HistoryKind.JOB],
        ["job_1"],
      ),
    ).toEqual({
      OR: [
        {
          kind: HistoryKind.TASK,
          status: { in: [TaskStatus.READY, TaskStatus.COMPLETED] },
          archivedAt: null,
        },
        {
          kind: HistoryKind.JOB,
          entityId: { in: ["job_1"] },
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
        userContext: { source: "session", ...orgAuthContext },
        workspaceContext: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: null,
          organizationId: "org_123",
        },
      },
      createHistoryPrismaClient({ $queryRaw: queryRawMock }),
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

    const statuses = await loadComputedJobStatusByEntityId(
      ["job_123"],
      createHistoryPrismaClient({ job: { findMany: findManyMock } }),
    );

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
