import { TaskStatus } from "@sokosumi/database";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import { requireUserAuthContext } from "@/middleware/auth";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { coworkerFindFirstMock, taskCountMock, taskFindManyMock } = vi.hoisted(
  () => ({
    coworkerFindFirstMock: vi.fn(),
    taskCountMock: vi.fn(),
    taskFindManyMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    task: {
      count: taskCountMock,
      findMany: taskFindManyMock,
    },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const { default: mountListDeveloperTasks } = await import("./get.js");

const accessibleCoworkerWhere = {
  OR: [
    {
      vendor: {
        vendorMembers: {
          some: {
            userId: "user_dev",
            role: "admin",
          },
        },
      },
    },
    {
      assignments: {
        some: {
          userId: "user_dev",
        },
      },
    },
  ],
};

interface AppOptions {
  actor?: "user" | "coworker";
  userId?: string;
}

function createApp(options: AppOptions = {}) {
  const { actor = "user", userId = "user_dev" } = options;
  const app = new OpenAPIHonoWithAuth();

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
  mountListDeveloperTasks(app);

  return app;
}

function createListTask() {
  return {
    id: "0195b9f4-7d35-7a4e-b14e-111111111111",
    name: "Quarterly report",
    status: TaskStatus.RUNNING,
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T11:00:00.000Z"),
    assignee: {
      id: "cow_owned",
      name: "Ops Agent",
      slug: "ops-agent",
    },
    creatorCoworker: null,
    owner: {
      id: "user_workspace",
      name: "Workspace User",
      email: "workspace@example.com",
    },
    organization: {
      id: "org_123",
      name: "Acme Corp",
      slug: "acme-corp",
    },
  };
}

describe("GET /developer/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskFindManyMock.mockResolvedValue([]);
    taskCountMock.mockResolvedValue(0);
  });

  it("returns paginated tasks for owned coworkers", async () => {
    taskFindManyMock.mockResolvedValue([createListTask()]);
    taskCountMock.mockResolvedValue(1);
    const app = createApp();

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          OR: [
            { assignee: accessibleCoworkerWhere },
            { creatorCoworker: accessibleCoworkerWhere },
          ],
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      }),
    );
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "0195b9f4-7d35-7a4e-b14e-111111111111",
      name: "Quarterly report",
      status: TaskStatus.RUNNING,
      assignee: {
        id: "cow_owned",
        name: "Ops Agent",
        slug: "ops-agent",
      },
      creatorCoworker: null,
      owner: {
        id: "user_workspace",
        name: "Workspace User",
        email: "workspace@example.com",
      },
      organization: {
        id: "org_123",
        name: "Acme Corp",
        slug: "acme-corp",
      },
    });
  });

  it("filters by owned coworkerId when provided", async () => {
    coworkerFindFirstMock.mockResolvedValue({ id: "cow_owned" });
    taskFindManyMock.mockResolvedValue([createListTask()]);
    taskCountMock.mockResolvedValue(1);
    const app = createApp();

    const response = await app.request("/?coworkerId=cow_owned");

    expect(response.status).toBe(200);
    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "cow_owned",
        archivedAt: null,
        ...accessibleCoworkerWhere,
      },
      select: { id: true },
    });
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          OR: [{ assigneeId: "cow_owned" }, { creatorCoworkerId: "cow_owned" }],
        },
      }),
    );
  });

  it("returns 404 when coworkerId is not owned", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("/?coworkerId=cow_other");

    expect(response.status).toBe(404);
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects coworker actors with 403", async () => {
    const app = createApp({ actor: "coworker" });

    const response = await app.request("/");

    expect(response.status).toBe(403);
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });
});
