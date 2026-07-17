import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const { taskFindUniqueMock } = vi.hoisted(() => ({
  taskFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findUnique: taskFindUniqueMock,
    },
  },
}));

const { default: mountGetAdminTask } = await import("./get.js");

interface AppOptions {
  role?: string;
  actor?: "user" | "coworker";
}

/**
 * Mounts the route behind the same `requireAdmin` guard the admin router applies
 * in production, so the tests exercise the real authorization boundary rather
 * than just the handler shape.
 */
function createApp(options: AppOptions = {}) {
  const { role = "admin", actor = "user" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_admin_test");
    c.set("isAuthenticated", true);

    if (actor === "coworker") {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
      });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: "user_admin",
        organizationId: null,
        role,
      });
    }

    await next();
  });

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountGetAdminTask(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function createTask() {
  return {
    id: "0195b9f4-7d35-7a4e-b14e-111111111111",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    userId: "user_123",
    user: {
      id: "user_123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: null,
    },
    organizationId: "org_123",
    projectId: null,
    organization: { id: "org_123", name: "Acme Corp", slug: "acme-corp" },
    coworkerId: null,
    coworker: null,
    orchestratorId: null,
    orchestrator: null,
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
  };
}

describe("GET /admin/tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the full task with owner and organization context", async () => {
    taskFindUniqueMock.mockResolvedValue(createTask());
    const app = createApp();

    const response = await app.request("/0195b9f4-7d35-7a4e-b14e-111111111111");

    expect(response.status).toBe(200);
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "0195b9f4-7d35-7a4e-b14e-111111111111" },
      include: expect.objectContaining({
        share: true,
        user: { select: { id: true, name: true, email: true, image: true } },
        organization: { select: { id: true, name: true, slug: true } },
      }),
    });
    const body = await response.json();
    expect(body.data.task).toMatchObject({
      id: "0195b9f4-7d35-7a4e-b14e-111111111111",
      name: "Quarterly report",
      status: TaskStatus.RUNNING,
      userId: "user_123",
      organizationId: "org_123",
      links: [],
    });
    expect(body.data.user).toEqual({
      id: "user_123",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(body.data.organization).toEqual({
      id: "org_123",
      name: "Acme Corp",
      slug: "acme-corp",
    });
  });

  it("returns a null organization for personal workspace tasks", async () => {
    const task = createTask();
    taskFindUniqueMock.mockResolvedValue({
      ...task,
      organizationId: null,
      organization: null,
      workspace: { ...task.workspace, organizationId: null },
    });
    const app = createApp();

    const response = await app.request("/0195b9f4-7d35-7a4e-b14e-111111111111");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.organization).toBeNull();
  });

  it("returns 404 when the task does not exist", async () => {
    taskFindUniqueMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("/tsk_missing");

    expect(response.status).toBe(404);
  });

  it("rejects non-admin users", async () => {
    const app = createApp({ role: "user" });

    const response = await app.request("/0195b9f4-7d35-7a4e-b14e-111111111111");

    expect(response.status).toBe(403);
    expect(taskFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects coworker actors", async () => {
    const app = createApp({ actor: "coworker" });

    const response = await app.request("/0195b9f4-7d35-7a4e-b14e-111111111111");

    expect(response.status).toBe(403);
    expect(taskFindUniqueMock).not.toHaveBeenCalled();
  });
});
