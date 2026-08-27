import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const { taskFindManyMock, taskCountMock, transactionMock, authContextState } =
  vi.hoisted(() => ({
    authContextState: {
      current: {
        actor: "user",
        userId: "user_admin",
        organizationId: null,
        role: "admin",
      } as AuthenticationContext,
    },
    taskFindManyMock: vi.fn(),
    taskCountMock: vi.fn(),
    transactionMock: vi.fn(),
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
    $transaction: transactionMock,
    task: { findMany: taskFindManyMock, count: taskCountMock },
  },
}));

const { default: mountListAdminTasks } = await import("./tasks/get.js");

interface AppOptions {
  role?: string;
  actor?: "user" | "coworker";
}

function createApp(
  mountRoutes: (app: OpenAPIHonoWithAuth) => void,
  options: AppOptions = {},
) {
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
  mountRoutes(app);

  return app;
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_1",
    name: "Quarterly report",
    status: "RUNNING",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    owner: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
    organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
    ...overrides,
  };
}

describe("GET /v1/admin/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (operations: unknown[]) =>
      Promise.all(operations),
    );
    taskFindManyMock.mockResolvedValue([makeTask()]);
    taskCountMock.mockResolvedValue(1);
  });

  it("returns tasks with user, organization, and pagination meta", async () => {
    const app = createApp(mountListAdminTasks);
    const res = await app.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      {
        id: "task_1",
        name: "Quarterly report",
        status: "RUNNING",
        createdAt: "2025-01-01T00:00:00.000Z",
        owner: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
        user: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com" },
        organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
      },
    ]);
    expect(body.meta.pagination).toMatchObject({ total: 1, nextCursor: null });
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        take: 21,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("returns null organization for personal tasks", async () => {
    taskFindManyMock.mockResolvedValue([makeTask({ organization: null })]);

    const app = createApp(mountListAdminTasks);
    const res = await app.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].organization).toBeNull();
  });

  it("builds an OR filter across id, name, user, and organization", async () => {
    const app = createApp(mountListAdminTasks);
    const res = await app.request("/?query=acme");

    expect(res.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { id: "acme" },
            { name: { contains: "acme", mode: "insensitive" } },
            {
              owner: {
                OR: [
                  { name: { contains: "acme", mode: "insensitive" } },
                  { email: { contains: "acme", mode: "insensitive" } },
                ],
              },
            },
            {
              organization: {
                OR: [
                  { name: { contains: "acme", mode: "insensitive" } },
                  { slug: { contains: "acme", mode: "insensitive" } },
                ],
              },
            },
          ],
        },
      }),
    );
  });

  it("treats a whitespace-only query as no filter", async () => {
    const app = createApp(mountListAdminTasks);
    const res = await app.request("/?query=%20%20");

    expect(res.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("sets nextCursor when there are more rows than the page size", async () => {
    taskFindManyMock.mockResolvedValue([
      makeTask({ id: "task_0" }),
      makeTask({ id: "task_1" }),
      makeTask({ id: "task_2" }),
    ]);
    taskCountMock.mockResolvedValue(10);

    const app = createApp(mountListAdminTasks);
    const res = await app.request("/?limit=2");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.pagination.nextCursor).toBe("task_1");
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
  });

  it("rejects queries longer than 255 characters", async () => {
    const app = createApp(mountListAdminTasks);
    const res = await app.request(`/?query=${"a".repeat(256)}`);

    expect(res.status).toBe(422);
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects limits above the admin list cap", async () => {
    const app = createApp(mountListAdminTasks);
    const res = await app.request("/?limit=51");

    expect(res.status).toBe(422);
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin users", async () => {
    const app = createApp(mountListAdminTasks, { role: "user" });
    const res = await app.request("/");

    expect(res.status).toBe(403);
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects coworker actors", async () => {
    const app = createApp(mountListAdminTasks, { actor: "coworker" });
    const res = await app.request("/");

    expect(res.status).toBe(403);
  });
});
