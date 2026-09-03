import { HistoryKind, TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import type { HistoryRowForApi } from "@/helpers/history";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetHistory from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  agentFindManyMock,
  historyCountMock,
  historyFindFirstMock,
  historyFindManyMock,
  jobFindManyMock,
  prismaQueryRawMock,
  prismaTransactionMock,
  userFindManyMock,
} = vi.hoisted(() => ({
  agentFindManyMock: vi.fn(),
  historyCountMock: vi.fn(),
  historyFindFirstMock: vi.fn(),
  historyFindManyMock: vi.fn(),
  jobFindManyMock: vi.fn(),
  prismaQueryRawMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  userFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: prismaQueryRawMock,
    $transaction: prismaTransactionMock,
    agent: {
      findMany: agentFindManyMock,
    },
    history: {
      count: historyCountMock,
      findFirst: historyFindFirstMock,
      findMany: historyFindManyMock,
    },
    job: {
      findMany: jobFindManyMock,
    },
    user: {
      findMany: userFindManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const WORKSPACE_CONTEXT = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: null,
  organizationId: "org_123",
} satisfies WorkspaceVariables["workspaceContext"];

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext: WorkspaceVariables["workspaceContext"] = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);

    return await next();
  });

  mountGetHistory(app);
  return app;
}

function createHistoryRow(
  overrides: Partial<HistoryRowForApi> = {},
): HistoryRowForApi {
  return {
    agentId: null,
    amount: 25_000_000_000n,
    archivedAt: null,
    bucketSlug: null,
    coworkerId: "cow_123",
    orchestratorId: null,
    description: "History row description",
    entityId: "entity_123",
    id: "history_123",
    kind: HistoryKind.TASK,
    projectId: "33333333-3333-4333-8333-333333333333",
    sortAt: new Date("2026-04-02T10:00:00.000Z"),
    status: TaskStatus.READY,
    title: "History Row",
    userId: "user_123",
    ...overrides,
  };
}

describe("GET /history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historyFindFirstMock.mockResolvedValue(null);
    historyFindManyMock.mockResolvedValue([]);
    historyCountMock.mockResolvedValue(0);
    jobFindManyMock.mockResolvedValue([]);
    agentFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
    prismaQueryRawMock.mockResolvedValue([]);
    prismaTransactionMock.mockImplementation(
      async (operations: Array<Promise<unknown>>) =>
        await Promise.all(operations),
    );
  });

  it("reads owned history rows from the history table by default", async () => {
    const row = createHistoryRow();
    historyFindManyMock.mockResolvedValue([row]);
    historyCountMock.mockResolvedValue(1);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(historyFindManyMock).toHaveBeenCalledWith({
      where: {
        AND: [
          { archivedAt: null },
          {
            OR: [
              {
                kind: { in: [HistoryKind.TASK, HistoryKind.JOB] },
                userId: "user_123",
                workspaceId: WORKSPACE_CONTEXT.workspaceId,
              },
            ],
          },
        ],
      },
      take: LIMITS.DEFAULT_PAGINATION_LIMIT + 1,
      skip: undefined,
      cursor: undefined,
      orderBy: [{ sortAt: "desc" }, { id: "desc" }],
    });
    expect(historyCountMock).toHaveBeenCalledWith({
      where: historyFindManyMock.mock.calls[0]?.[0]?.where,
    });

    const body = (await response.json()) as {
      data: Array<{ credits: number; id: string; kind: string }>;
      meta: { pagination: { nextCursor: string | null; total: number } };
    };
    expect(body.data).toEqual([
      expect.objectContaining({
        credits: 2.5,
        id: "entity_123",
        kind: "task",
      }),
    ]);
    expect(body.meta.pagination.total).toBe(1);
    expect(body.meta.pagination.nextCursor).toBeNull();
  });

  it("uses workspace scope without user filter when scope=workspace", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?scope=workspace");

    expect(response.status).toBe(200);
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { archivedAt: null },
            {
              OR: [
                {
                  kind: { in: [HistoryKind.TASK, HistoryKind.JOB] },
                  workspaceId: WORKSPACE_CONTEXT.workspaceId,
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("filters types and projectId on task and job rows", async () => {
    const projectId = "33333333-3333-4333-8333-333333333333";
    const app = createApp();
    const response = await app.request(
      `http://localhost/?types=task&projectId=${projectId}`,
    );

    expect(response.status).toBe(200);
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { archivedAt: null },
            {
              OR: [
                {
                  kind: { in: [HistoryKind.TASK] },
                  projectId,
                  userId: "user_123",
                  workspaceId: WORKSPACE_CONTEXT.workspaceId,
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("filters unassigned task rows when projectId=null", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?types=task&projectId=null",
    );

    expect(response.status).toBe(200);
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { archivedAt: null },
            {
              OR: [
                {
                  kind: { in: [HistoryKind.TASK] },
                  projectId: null,
                  userId: "user_123",
                  workspaceId: WORKSPACE_CONTEXT.workspaceId,
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("includes archived tasks when status filter requests archived", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?types=task&status=archived",
    );

    expect(response.status).toBe(200);
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                {
                  kind: { in: [HistoryKind.TASK] },
                  userId: "user_123",
                  workspaceId: WORKSPACE_CONTEXT.workspaceId,
                },
              ],
            },
            {
              OR: [
                {
                  kind: HistoryKind.TASK,
                  archivedAt: { not: null },
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("applies status filters with computed job status matching", async () => {
    prismaQueryRawMock.mockResolvedValue([{ entityId: "job_completed" }]);

    const app = createApp();
    const response = await app.request(
      "http://localhost/?status=READY,completed&status=READY",
    );

    expect(response.status).toBe(200);
    expect(prismaQueryRawMock).toHaveBeenCalledTimes(1);
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                {
                  kind: HistoryKind.TASK,
                  status: {
                    in: [TaskStatus.READY, TaskStatus.COMPLETED],
                  },
                  archivedAt: null,
                },
                {
                  kind: HistoryKind.JOB,
                  entityId: { in: ["job_completed"] },
                },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("excludes task rows when only job status filters are provided", async () => {
    prismaQueryRawMock.mockResolvedValue([{ entityId: "job_payment_pending" }]);

    const app = createApp();
    const response = await app.request(
      `http://localhost/?status=${SokosumiJobStatus.PAYMENT_PENDING}`,
    );

    expect(response.status).toBe(200);
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                {
                  kind: HistoryKind.JOB,
                  entityId: { in: ["job_payment_pending"] },
                },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("overlays computed job status on timed-out payment-pending rows", async () => {
    const payByTime = new Date(Date.now() - 11 * 60 * 1000);
    const row = createHistoryRow({
      agentId: "agent_123",
      entityId: "job_timed_out",
      kind: HistoryKind.JOB,
      status: SokosumiJobStatus.PAYMENT_PENDING,
    });
    historyFindManyMock.mockResolvedValue([row]);
    historyCountMock.mockResolvedValue(1);
    jobFindManyMock.mockResolvedValue([
      {
        createdAt: payByTime,
        events: [],
        externalDisputeUnlockTime: null,
        id: "job_timed_out",
        jobType: "PAID",
        payByTime,
        projectId: null,
        purchase: null,
        refundedTransactionId: null,
        submitResultTime: null,
      },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(jobFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["job_timed_out"] } },
      select: expect.objectContaining({
        jobType: true,
        payByTime: true,
        purchase: true,
      }),
    });

    const body = (await response.json()) as {
      data: Array<{ id: string; kind: string; status: string }>;
    };
    expect(body.data[0]).toMatchObject({
      id: "job_timed_out",
      kind: "job",
      status: SokosumiJobStatus.PAYMENT_FAILED,
    });
  });

  it("searches title and description when q is provided", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?q=onboarding");

    expect(response.status).toBe(200);
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                {
                  title: {
                    contains: "onboarding",
                    mode: "insensitive",
                  },
                },
                {
                  description: {
                    contains: "onboarding",
                    mode: "insensitive",
                  },
                },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("resolves entity ids to history row ids for pagination cursors", async () => {
    historyFindFirstMock.mockResolvedValue({ id: "history_cursor" });

    const app = createApp();
    const response = await app.request(
      "http://localhost/?cursor=entity_cursor&limit=10",
    );

    expect(response.status).toBe(200);
    expect(historyFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ entityId: "entity_cursor" }]),
        }),
        select: { id: true },
        orderBy: [{ sortAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "history_cursor" },
        skip: 1,
        take: 11,
      }),
    );
  });

  it("returns the next item entity id as cursor", async () => {
    const visibleRow = createHistoryRow({
      amount: null,
      entityId: "task_1",
      kind: HistoryKind.TASK,
      projectId: null,
      status: TaskStatus.READY,
    });
    historyFindManyMock.mockResolvedValue([
      visibleRow,
      createHistoryRow({ entityId: "extra_row" }),
    ]);
    historyCountMock.mockResolvedValue(2);

    const app = createApp();
    const response = await app.request("http://localhost/?limit=1");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ credits: number | null; kind: string }>;
      meta: { pagination: { nextCursor: string | null } };
    };
    expect(body.data).toEqual([
      expect.objectContaining({
        credits: null,
        kind: "task",
      }),
    ]);
    expect(body.meta.pagination.nextCursor).toBe(visibleRow.entityId);
  });

  it("enriches job rows with resolved agent name and icon", async () => {
    historyFindManyMock.mockResolvedValue([
      createHistoryRow({
        agentId: "agent_123",
        entityId: "job_1",
        kind: HistoryKind.JOB,
        status: SokosumiJobStatus.COMPLETED,
      }),
      createHistoryRow({
        agentId: "agent_123",
        entityId: "job_2",
        kind: HistoryKind.JOB,
        status: SokosumiJobStatus.COMPLETED,
      }),
    ]);
    historyCountMock.mockResolvedValue(2);
    agentFindManyMock.mockResolvedValue([
      {
        id: "agent_123",
        name: "Base Name",
        metadataOverride: { name: "Research Agent" },
        icon: "https://example.com/research.svg",
      },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["agent_123"] } },
      select: {
        id: true,
        name: true,
        icon: true,
        metadataOverride: { select: { name: true } },
      },
    });

    const body = (await response.json()) as {
      data: Array<{
        agentIcon: string | null;
        agentName: string | null;
        id: string;
        kind: string;
      }>;
    };
    expect(body.data[0]).toMatchObject({
      id: "job_1",
      kind: "job",
      agentName: "Research Agent",
      agentIcon: "https://example.com/research.svg",
    });
  });

  it("degrades job agent fields to null when agent lookup fails", async () => {
    historyFindManyMock.mockResolvedValue([
      createHistoryRow({
        agentId: "agent_123",
        entityId: "job_1",
        kind: HistoryKind.JOB,
        status: SokosumiJobStatus.COMPLETED,
      }),
    ]);
    historyCountMock.mockResolvedValue(1);
    agentFindManyMock.mockRejectedValue(new Error("db down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        agentIcon: string | null;
        agentName: string | null;
        kind: string;
      }>;
    };
    expect(body.data[0]).toMatchObject({
      kind: "job",
      agentName: null,
      agentIcon: null,
    });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
