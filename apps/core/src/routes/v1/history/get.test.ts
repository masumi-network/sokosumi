import { OpenAPIHono } from "@hono/zod-openapi";
import { HistoryKind, TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import type { HistoryRowForApi } from "@/helpers/history";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetHistory from "./get";

const { historyCountMock, historyFindManyMock, prismaTransactionMock } =
  vi.hoisted(() => ({
    historyCountMock: vi.fn(),
    historyFindManyMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    history: {
      count: historyCountMock,
      findMany: historyFindManyMock,
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
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);

    return await next();
  });

  mountGetHistory(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function createHistoryRow(
  overrides: Partial<HistoryRowForApi> = {},
): HistoryRowForApi {
  return {
    agentId: null,
    bucketSlug: null,
    coworkerId: "cow_123",
    creditsCents: 25_000_000_000n,
    description: "History row description",
    entityId: "entity_123",
    id: "history_123",
    kind: HistoryKind.TASK,
    projectId: "33333333-3333-4333-8333-333333333333",
    sortAt: new Date("2026-04-02T10:00:00.000Z"),
    status: TaskStatus.READY,
    title: "History Row",
    ...overrides,
  };
}

describe("GET /history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historyFindManyMock.mockResolvedValue([]);
    historyCountMock.mockResolvedValue(0);
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
              {
                kind: HistoryKind.CONVERSATION,
                userId: "user_123",
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

  it("keeps conversations user-scoped when scope=workspace", async () => {
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
                {
                  kind: HistoryKind.CONVERSATION,
                  userId: "user_123",
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
      `http://localhost/?types=task,conversation&projectId=${projectId}`,
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

  it("applies status filters", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?status=READY,completed&status=READY",
    );

    expect(response.status).toBe(200);
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { status: { in: [TaskStatus.READY, SokosumiJobStatus.COMPLETED] } },
          ]),
        }),
      }),
    );
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

  it("uses the history row id as the pagination cursor", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?cursor=history_cursor&limit=10",
    );

    expect(response.status).toBe(200);
    expect(historyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "history_cursor" },
        skip: 1,
        take: 11,
      }),
    );
  });

  it("returns the next history row id cursor and null conversation credits", async () => {
    const visibleRow = createHistoryRow({
      bucketSlug: "hannah",
      creditsCents: null,
      entityId: "conversation_1",
      kind: HistoryKind.CONVERSATION,
      projectId: null,
      status: "active",
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
        kind: "conversation",
      }),
    ]);
    expect(body.meta.pagination.nextCursor).toBe(visibleRow.id);
  });
});
