import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/config/constants";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";
import { createProjectListCountsInclude } from "@/types/project";

import mountListProjects from "./get.js";

const { projectCountMock, projectFindManyMock, prismaTransactionMock } =
  vi.hoisted(() => ({
    projectCountMock: vi.fn(),
    projectFindManyMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    project: {
      findMany: projectFindManyMock,
      count: projectCountMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_CONTEXT = {
  workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext:
    | WorkspaceVariables["workspaceContext"]
    | null = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);

    return await next();
  });

  mountListProjects(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindManyMock.mockResolvedValue([]);
    projectCountMock.mockResolvedValue(0);
    prismaTransactionMock.mockImplementation(
      async (arg: [Promise<unknown>, Promise<unknown>]) =>
        await Promise.all(arg),
    );
  });

  it("returns projects for the active workspace with pagination metadata", async () => {
    const sample = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: WORKSPACE_CONTEXT.workspaceId,
      name: "Research",
      websiteUrl: null,
      logo: null,
      designMdUrl: null,
      designMdExtractionId: null,
      briefing: "Notes",
      briefingUrl: "https://blob.example/projects/project_1/BRIEFING.md",
      contextMd: null,
      contextMdUrl: null,
      contextMdUpdatedAt: null,
      contextMdModel: null,
      contextMdUpdatingSince: null,
      contextMdVersion: 0,
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      updatedAt: new Date("2026-04-01T10:00:00.000Z"),
      _count: {
        tasks: 2,
        jobs: 1,
      },
    };
    projectFindManyMock.mockResolvedValue([sample]);
    projectCountMock.mockResolvedValue(1);

    const app = createApp();
    const res = await app.request("http://localhost/");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        name: string;
        taskCount: number;
        jobCount: number;
      }>;
      meta: {
        pagination: {
          total: number;
          limit: number;
          nextCursor: string | null;
          cursor: string | null;
        };
      };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.data[0]?.name).toBe("Research");
    expect(body.data[0]?.taskCount).toBe(2);
    expect(body.data[0]?.jobCount).toBe(1);
    expect(body.meta.pagination.total).toBe(1);
    expect(body.meta.pagination.limit).toBe(LIMITS.DEFAULT_PAGINATION_LIMIT);
    expect(body.meta.pagination.nextCursor).toBeNull();
    expect(body.meta.pagination.cursor).toBeNull();

    expect(projectFindManyMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_CONTEXT.workspaceId },
      include: createProjectListCountsInclude(WORKSPACE_CONTEXT.workspaceId),
      take: LIMITS.DEFAULT_PAGINATION_LIMIT + 1,
      skip: undefined,
      cursor: undefined,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    expect(projectCountMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_CONTEXT.workspaceId },
    });
  });

  it("returns nextCursor when more than one page of results exists", async () => {
    const rows = Array.from(
      { length: LIMITS.DEFAULT_PAGINATION_LIMIT + 1 },
      (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        workspaceId: WORKSPACE_CONTEXT.workspaceId,
        name: `P${i}`,
        websiteUrl: null,
        logo: null,
        designMdUrl: null,
        designMdExtractionId: null,
        briefing: null,
        briefingUrl: null,
        contextMd: null,
        contextMdUrl: null,
        contextMdUpdatedAt: null,
        contextMdModel: null,
        contextMdUpdatingSince: null,
        contextMdVersion: 0,
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        updatedAt: new Date("2026-04-01T10:00:00.000Z"),
        _count: {
          tasks: 0,
          jobs: 0,
        },
      }),
    );
    projectFindManyMock.mockResolvedValue(rows);
    projectCountMock.mockResolvedValue(50);

    const app = createApp();
    const res = await app.request("http://localhost/");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      meta: { pagination: { nextCursor: string | null } };
    };
    expect(body.data).toHaveLength(LIMITS.DEFAULT_PAGINATION_LIMIT);
    expect(body.meta.pagination.nextCursor).toBe(
      body.data[LIMITS.DEFAULT_PAGINATION_LIMIT - 1]?.id ?? null,
    );
  });

  it("passes cursor and skip when requesting the next page", async () => {
    const cursorId = "11111111-1111-4111-8111-111111111111";
    projectFindManyMock.mockResolvedValue([]);
    projectCountMock.mockResolvedValue(0);

    const app = createApp();
    const res = await app.request(
      `http://localhost/?cursor=${encodeURIComponent(cursorId)}&limit=10`,
    );

    expect(res.status).toBe(200);
    expect(projectFindManyMock).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_CONTEXT.workspaceId },
      include: createProjectListCountsInclude(WORKSPACE_CONTEXT.workspaceId),
      take: 11,
      skip: 1,
      cursor: { id: cursorId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
  });

  it("returns 403 when workspace context is missing", async () => {
    const app = createApp(USER_AUTH_CONTEXT, null);
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(403);
  });

  it("returns 403 for coworker without delegation", async () => {
    const app = createApp(
      { actor: "coworker", coworkerId: "cow_1", vendorId: TEST_VENDOR_ID },
      null,
    );
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(403);
  });
});
