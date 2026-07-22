import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireUserAuthContext } from "@/middleware/auth";

const { taskFindFirstMock } = vi.hoisted(() => ({
  taskFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findFirst: taskFindFirstMock,
    },
  },
}));

const { default: mountGetDeveloperTask } = await import("./get.js");

interface AppOptions {
  actor?: "user" | "coworker";
  userId?: string;
}

function createApp(options: AppOptions = {}) {
  const { actor = "user", userId = "user_dev" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_developer_test");
    c.set("isAuthenticated", true);

    if (actor === "coworker") {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: "01960001-0001-7001-8001-000000000001",
      });
    } else {
      c.set("authContext", {
        actor: "user",
        userId,
        organizationId: null,
        role: "user",
      });
    }

    await next();
  });

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireUserAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountGetDeveloperTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function createTask() {
  return {
    id: "0195b9f4-7d35-7a4e-b14e-111111111111",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    archivedAt: null,
    ownerId: "user_workspace",
    owner: {
      id: "user_workspace",
      name: "Workspace User",
      email: "workspace@example.com",
      image: null,
    },
    organizationId: "org_123",
    projectId: null,
    organization: { id: "org_123", name: "Acme Corp", slug: "acme-corp" },
    assigneeId: "cow_owned",
    assignee: {
      id: "cow_owned",
      name: "Ops Agent",
      image: null,
      slug: "ops-agent",
      vendorId: "01960001-0001-7001-8001-000000000001",
      userId: "user_dev",
    },
    creatorUserId: "user_workspace",
    creatorUser: {
      id: "user_workspace",
      name: "Workspace User",
      image: null,
    },
    creatorCoworkerId: null,
    creatorCoworker: null,
    creatorOrchestratorId: null,
    creatorOrchestrator: null,
    name: "Quarterly report",
    description: null,
    status: TaskStatus.RUNNING,
    metadata: null,
    nextRunAt: null,
    events: [],
    jobs: [],
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
      organization: { id: "org_123", name: "Acme Corp", slug: "acme-corp" },
    },
    share: null,
    linksFrom: [],
    linksTo: [],
    pendingVendorGrantId: null,
    pendingVendorGrant: null,
    grantResumeStatus: null,
  };
}

describe("GET /developer/tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns full task with owner and organization for owned coworker tasks", async () => {
    taskFindFirstMock.mockResolvedValue(createTask());
    const app = createApp();

    const response = await app.request("/0195b9f4-7d35-7a4e-b14e-111111111111");

    expect(response.status).toBe(200);
    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "0195b9f4-7d35-7a4e-b14e-111111111111",
          archivedAt: null,
          OR: [
            { assignee: { userId: "user_dev" } },
            { creatorCoworker: { userId: "user_dev" } },
          ],
        },
      }),
    );
    const body = await response.json();
    expect(body.data.task).toMatchObject({
      id: "0195b9f4-7d35-7a4e-b14e-111111111111",
      name: "Quarterly report",
      status: TaskStatus.RUNNING,
      links: [],
    });
    expect(body.data.owner).toEqual({
      id: "user_workspace",
      name: "Workspace User",
      email: "workspace@example.com",
    });
    expect(body.data.organization).toEqual({
      id: "org_123",
      name: "Acme Corp",
      slug: "acme-corp",
    });
    expect(body.data.user).toBeUndefined();
  });

  it("returns 404 when the task is not visible to the developer", async () => {
    taskFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("/tsk_missing");

    expect(response.status).toBe(404);
  });

  it("rejects coworker actors with 403", async () => {
    const app = createApp({ actor: "coworker" });

    const response = await app.request("/0195b9f4-7d35-7a4e-b14e-111111111111");

    expect(response.status).toBe(403);
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });
});
