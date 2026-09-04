import { TaskStatus } from "@sokosumi/database";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const { taskFindUniqueMock, authContextState } = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  taskFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

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
  if (actor === "coworker") {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    };
  } else {
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role,
    };
  }

  const app = new OpenAPIHonoWithAuth();

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountGetAdminTask(app);

  return app;
}

function createTask() {
  return {
    id: "0195b9f4-7d35-7a4e-b14e-111111111111",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    ownerId: "user_123",
    owner: {
      id: "user_123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: null,
    },
    organizationId: "org_123",
    projectId: null,
    organization: { id: "org_123", name: "Acme Corp", slug: "acme-corp" },
    assigneeId: null,
    assigneeSokoBotId: null,
    assignee: null,
    creatorUserId: "user_123",
    creatorUser: {
      id: "user_123",
      name: "Ada Lovelace",
      image: null,
    },
    creatorCoworkerId: null,
    creatorCoworker: null,
    creatorSokoBotId: null,
    creatorSokoBot: null,
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
        owner: { select: { id: true, name: true, email: true, image: true } },
        organization: { select: { id: true, name: true, slug: true } },
      }),
    });
    const body = await response.json();
    expect(body.data.task).toMatchObject({
      id: "0195b9f4-7d35-7a4e-b14e-111111111111",
      name: "Quarterly report",
      status: TaskStatus.RUNNING,
      ownerId: "user_123",
      organizationId: "org_123",
      links: [],
      files: [],
    });
    expect(body.data.owner).toEqual({
      id: "user_123",
      name: "Ada Lovelace",
      email: "ada@example.com",
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
