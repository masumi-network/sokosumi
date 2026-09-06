import { jobListSummaryInclude } from "@sokosumi/database/types/job";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetTaskJobs from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { jobFindManyMock, requireTaskReadForRouteVarsMock } = vi.hoisted(() => ({
  jobFindManyMock: vi.fn(),
  requireTaskReadForRouteVarsMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadForRouteVarsMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    job: {
      findMany: jobFindManyMock,
    },
  },
}));

const testWorkspaceId = "11111111-1111-7111-8111-111111111111";

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: testWorkspaceId,
      userId: null,
      organizationId: "org_123",
    });

    return await next();
  });

  mountGetTaskJobs(app);

  return app;
}

describe("GET /tasks/{id}/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
    jobFindManyMock.mockResolvedValue([]);
  });

  it("reads task jobs without a scope query", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/jobs");

    expect(response.status).toBe(200);
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isAuthenticated: true,
        authContext: {
          actor: "user",
          userId: "user_123",
          organizationId: "org_123",
          role: "user",
        },
        workspaceContext: {
          workspaceId: testWorkspaceId,
          userId: null,
          organizationId: "org_123",
        },
      }),
      "tsk_123",
      expect.any(Object),
    );
    expect(jobFindManyMock).toHaveBeenCalledWith({
      where: { taskId: "tsk_123" },
      include: jobListSummaryInclude,
      orderBy: { createdAt: "asc" },
    });
  });
});
