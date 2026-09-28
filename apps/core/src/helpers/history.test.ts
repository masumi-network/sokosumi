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

type HistoryPrismaClient = Pick<typeof prisma, "$queryRaw" | "job" | "task">;

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
    task?: Pick<HistoryPrismaClient["task"], "findMany">;
  } = {},
): HistoryPrismaClient {
  return {
    $queryRaw: vi.fn(),
    job: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
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
    sokoBotId: null,
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

  it("maps an image row to the image variant, resolving the model label live", () => {
    const row = createHistoryRow({
      entityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: HistoryKind.IMAGE,
      status: "active",
      projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      title: "A bold event poster",
      // What the trigger writes: the endpoint, then the credits. SQL cannot see
      // the studio catalog's display labels, so they are resolved here.
      description: "fal-ai/gemini-3.1-flash-image-preview · 8 credits",
      amount: 80_000_000_000n,
      agentId: null,
    });

    expect(mapHistoryRow(row)).toEqual({
      kind: "image",
      id: row.entityId,
      assetId: row.entityId,
      title: "A bold event poster",
      description: "fal-ai/gemini-3.1-flash-image-preview · 8 credits",
      status: "active",
      createdAt: row.sortAt.toISOString(),
      archivedAt: null,
      credits: 8,
      projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      modelLabel: "Gemini 3.1 Flash Image",
      owner: null,
    });
  });

  it("still names the model for an endpoint the catalog no longer lists", () => {
    // A withdrawn model must not take the feed down, and the endpoint is still
    // true about what made the image.
    const row = createHistoryRow({
      entityId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      kind: HistoryKind.IMAGE,
      status: "active",
      description: "fal-ai/withdrawn-last-year · 3 credits",
      amount: 30_000_000_000n,
      agentId: null,
    });

    expect(mapHistoryRow(row)).toMatchObject({
      kind: "image",
      modelLabel: "withdrawn-last-year",
      credits: 3,
    });
  });

  it("reads a refunded image row as having cost nothing", () => {
    const row = createHistoryRow({
      entityId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      kind: HistoryKind.IMAGE,
      status: "active",
      description: "fal-ai/gemini-3.1-flash-image-preview · 0 credits",
      // The trigger writes the charge net of any refund, so a failure that was
      // paid back reads as zero rather than as money the person bore.
      amount: 0n,
      agentId: null,
    });

    expect(mapHistoryRow(row)).toMatchObject({ kind: "image", credits: 0 });
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
  it("matches non-archived task rows on stored status", () => {
    expect(
      buildHistoryStatusFilter(
        [TaskStatus.READY, "active"],
        [HistoryKind.TASK],
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

  it("matches archived tasks using archivedAt", () => {
    expect(
      buildHistoryStatusFilter(["archived"], [HistoryKind.TASK], []),
    ).toEqual({
      OR: [
        {
          kind: HistoryKind.TASK,
          archivedAt: { not: null },
        },
      ],
    });
  });

  it("includes both archived and non-archived task rows when active and archived are requested", () => {
    expect(
      buildHistoryStatusFilter(["active", "archived"], [HistoryKind.TASK], []),
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

  it("matches non-archived task and job rows when active is the only status filter", () => {
    expect(
      buildHistoryStatusFilter(
        ["active"],
        [HistoryKind.TASK, HistoryKind.JOB],
        undefined,
      ),
    ).toEqual({
      OR: [
        {
          kind: HistoryKind.TASK,
          archivedAt: null,
        },
        {
          kind: HistoryKind.JOB,
          archivedAt: null,
        },
      ],
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

describe("image rows in the status filter", () => {
  it("includes image rows for `active` and for no status filter at all", () => {
    for (const statuses of [["active"], []]) {
      expect(
        buildHistoryStatusFilter(statuses, [HistoryKind.IMAGE], undefined),
      ).toEqual({
        OR: [{ kind: HistoryKind.IMAGE, archivedAt: null }],
      });
    }
  });

  it("excludes image rows from a filter naming task or job states", () => {
    // An image has no status of its own — the row exists because the image does
    // — so "show me everything that failed" is not a question about images.
    expect(
      buildHistoryStatusFilter(
        [TaskStatus.FAILED],
        [HistoryKind.IMAGE],
        undefined,
      ),
    ).toEqual({ id: { in: [] } });
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

describe("buildHistoryWhere", () => {
  it("excludes other members' private tasks and their jobs in workspace scope", async () => {
    const taskFindManyMock = vi
      .fn()
      .mockResolvedValue([{ id: "task_private" }]);
    const jobFindManyMock = vi.fn().mockResolvedValue([{ id: "job_hidden" }]);
    const { buildHistoryWhere } = await import("./history");

    const where = await buildHistoryWhere(
      {
        scope: "workspace",
        types: [HistoryKind.TASK, HistoryKind.JOB, HistoryKind.IMAGE],
        userContext: { source: "session", ...orgAuthContext },
        workspaceContext: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: null,
          organizationId: "org_123",
        },
      },
      createHistoryPrismaClient({
        task: { findMany: taskFindManyMock },
        job: { findMany: jobFindManyMock },
      }),
    );

    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        visibility: "PRIVATE",
        ownerId: { not: "user_123" },
      },
      select: { id: true },
    });
    expect(where).toEqual({
      AND: [
        { archivedAt: null },
        {
          OR: [
            {
              // Images are workspace-scoped too: a generation belongs to a
              // project, which belongs to a workspace.
              kind: {
                in: [HistoryKind.TASK, HistoryKind.JOB, HistoryKind.IMAGE],
              },
              workspaceId: "11111111-1111-7111-8111-111111111111",
            },
          ],
        },
        {
          NOT: {
            OR: [
              {
                kind: HistoryKind.TASK,
                entityId: { in: ["task_private"] },
              },
              {
                kind: HistoryKind.JOB,
                entityId: { in: ["job_hidden"] },
              },
            ],
          },
        },
      ],
    });
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
