import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const {
  listUsersForAdminOverviewMock,
  getCreditsMock,
  resolveActiveSubscriptionMock,
  taskGroupByMock,
} = vi.hoisted(() => ({
  listUsersForAdminOverviewMock: vi.fn(),
  getCreditsMock: vi.fn(),
  resolveActiveSubscriptionMock: vi.fn(),
  taskGroupByMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { task: { groupBy: taskGroupByMock } },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: { listUsersForAdminOverview: listUsersForAdminOverviewMock },
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: resolveActiveSubscriptionMock,
  },
}));

vi.mock("@/helpers/user", () => ({ getCredits: getCreditsMock }));

const { default: mountListAdminUserOverview } = await import(
  "./users/overview/get.js"
);

interface AppOptions {
  role?: string;
  actor?: "user" | "coworker";
}

function createApp(
  mountRoutes: (app: OpenAPIHonoWithAuth) => void,
  options: AppOptions = {},
) {
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
      c.set("authContext", { actor: "coworker", coworkerId: "cow_123" });
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
  mountRoutes(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("GET /v1/admin/users/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsersForAdminOverviewMock.mockResolvedValue({
      users: [
        {
          id: "user_1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      ],
      total: 1,
    });
    getCreditsMock.mockResolvedValue(42.5);
    resolveActiveSubscriptionMock.mockResolvedValue({
      plan: "pro",
      status: "active",
    });
    taskGroupByMock.mockResolvedValue([
      { userId: "user_1", _count: { _all: 7 } },
    ]);
  });

  it("returns enriched users with pagination meta", async () => {
    const app = createApp(mountListAdminUserOverview);
    const res = await app.request("/overview?query=ada");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      {
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        createdAt: "2025-01-01T00:00:00.000Z",
        credits: 42.5,
        subscriptionPlan: "pro",
        subscriptionStatus: "active",
        startedTaskCount: 7,
      },
    ]);
    expect(body.meta.pagination).toMatchObject({
      total: 1,
      nextCursor: null,
    });
    expect(listUsersForAdminOverviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "ada", take: 21 }),
      expect.anything(),
    );
    expect(getCreditsMock).toHaveBeenCalledWith(
      "user_1",
      null,
      expect.anything(),
    );
    expect(resolveActiveSubscriptionMock).toHaveBeenCalledWith(
      "user_1",
      expect.anything(),
    );
    expect(taskGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["userId"],
        where: expect.objectContaining({
          userId: { in: ["user_1"] },
          status: { not: "DRAFT" },
        }),
      }),
    );
  });

  it("defaults missing enrichment to null/zero", async () => {
    resolveActiveSubscriptionMock.mockResolvedValue(null);
    taskGroupByMock.mockResolvedValue([]);

    const app = createApp(mountListAdminUserOverview);
    const res = await app.request("/overview");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({
      subscriptionPlan: null,
      subscriptionStatus: null,
      startedTaskCount: 0,
    });
  });

  it("sets nextCursor when there are more rows than the page size", async () => {
    listUsersForAdminOverviewMock.mockResolvedValue({
      users: Array.from({ length: 3 }, (_, i) => ({
        id: `user_${i}`,
        name: `User ${i}`,
        email: `u${i}@example.com`,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      })),
      total: 10,
    });
    getCreditsMock.mockResolvedValue(0);
    resolveActiveSubscriptionMock.mockResolvedValue(null);
    taskGroupByMock.mockResolvedValue([]);

    const app = createApp(mountListAdminUserOverview);
    const res = await app.request("/overview?limit=2");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.pagination.nextCursor).toBe("user_1");
    expect(listUsersForAdminOverviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
      expect.anything(),
    );
  });

  it("skips task aggregation for an empty page", async () => {
    listUsersForAdminOverviewMock.mockResolvedValue({ users: [], total: 0 });

    const app = createApp(mountListAdminUserOverview);
    const res = await app.request("/overview?query=nobody");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(taskGroupByMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin users", async () => {
    const app = createApp(mountListAdminUserOverview, { role: "user" });
    const res = await app.request("/overview");

    expect(res.status).toBe(403);
    expect(listUsersForAdminOverviewMock).not.toHaveBeenCalled();
  });

  it("rejects coworker actors", async () => {
    const app = createApp(mountListAdminUserOverview, { actor: "coworker" });
    const res = await app.request("/overview");

    expect(res.status).toBe(403);
  });
});
