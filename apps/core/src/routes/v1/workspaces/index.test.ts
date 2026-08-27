import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const { taskFindManyMock, taskScheduleOccurrenceFindManyMock } = vi.hoisted(
  () => ({
    taskFindManyMock: vi.fn(),
    taskScheduleOccurrenceFindManyMock: vi.fn(),
  }),
);

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));

vi.mock("@/middleware/coworker-context", () => ({
  coworkerContextMiddleware: async (
    _c: unknown,
    next: () => Promise<unknown>,
  ) => await next(),
}));

vi.mock("@/middleware/organization", () => ({
  organizationHeaderMiddleware: async (
    _c: unknown,
    next: () => Promise<unknown>,
  ) => await next(),
}));

vi.mock("@/middleware/workspace", () => ({
  requireWorkspaceContext: (
    workspaceContext: EnvVariables["Variables"]["workspaceContext"],
  ) => {
    if (!workspaceContext) {
      throw new Error("Workspace is missing");
    }
    return workspaceContext;
  },
  workspaceMiddleware:
    (includeWorkspaceContext: boolean) =>
    async (
      c: {
        set: (key: string, value: unknown) => void;
        var: EnvVariables["Variables"];
      },
      next: () => Promise<unknown>,
    ) => {
      if (c.var.authContext.actor !== "user") {
        c.set("workspaceContext", null);
        return await next();
      }

      const { authContext } = c.var;
      c.set(
        "workspaceContext",
        includeWorkspaceContext
          ? authContext.organizationId
            ? {
                workspaceId: "22222222-2222-7222-8222-222222222222",
                userId: null,
                organizationId: authContext.organizationId,
              }
            : {
                workspaceId: "11111111-1111-7111-8111-111111111111",
                userId: authContext.userId,
                organizationId: null,
              }
          : null,
      );
      return await next();
    },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findMany: taskFindManyMock },
    taskScheduleOccurrence: {
      findMany: taskScheduleOccurrenceFindManyMock,
    },
  },
}));

let workspacesRouter: Hono<EnvVariables>;

function createApp(authContext: AuthenticationContext) {
  const app = new Hono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_active_calendar");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  app.route("/", workspacesRouter);
  return app;
}

describe("GET /workspaces/calendar", () => {
  beforeAll(async () => {
    const module = await import("./index");
    workspacesRouter = module.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    taskFindManyMock.mockResolvedValue([]);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
  });

  it("reads the calendar for the active organization workspace", async () => {
    const response = await createApp({
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    }).request(
      "http://localhost/calendar?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z",
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "22222222-2222-7222-8222-222222222222",
        }),
      }),
    );
  });

  it("reads the calendar for the personal workspace without an active organization", async () => {
    const response = await createApp({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    }).request(
      "http://localhost/calendar?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z",
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "11111111-1111-7111-8111-111111111111",
        }),
      }),
    );
  });
});
