import { OpenAPIHono } from "@hono/zod-openapi";
import { jobSummaryInclude } from "@sokosumi/database/types/job";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthWithWorkspaceEnv } from "@/middleware/workspace-context";

import mountGetTaskJobs from "./get";

const { jobFindManyMock, prismaTransactionMock, requireTaskReadAccessMock } =
  vi.hoisted(() => ({
    jobFindManyMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
    requireTaskReadAccessMock: vi.fn(),
  }));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadAccess: requireTaskReadAccessMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

function createApp() {
  const app = new OpenAPIHono<AuthWithWorkspaceEnv>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
    });
    c.set("workspaceContext", {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    });

    return await next();
  });

  mountGetTaskJobs(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("GET /tasks/{id}/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskReadAccessMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        job: {
          findMany: jobFindManyMock,
        },
      });
    });
    jobFindManyMock.mockResolvedValue([]);
  });

  it("reads task jobs without a scope query", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/jobs");

    expect(response.status).toBe(200);
    expect(requireTaskReadAccessMock).toHaveBeenCalledWith(
      {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
      {
        workspaceId: "11111111-1111-7111-8111-111111111111",
        userId: null,
        organizationId: "org_123",
      },
      "tsk_123",
      expect.any(Object),
    );
    expect(jobFindManyMock).toHaveBeenCalledWith({
      where: { taskId: "tsk_123" },
      include: jobSummaryInclude,
      orderBy: { createdAt: "asc" },
    });
  });
});
