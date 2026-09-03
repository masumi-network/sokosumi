import {
  CalendarSourceType,
  TaskStatus,
  VendorGrantStatus,
} from "@sokosumi/database";
import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  coworkerFindFirstMock,
  projectFindFirstMock,
  taskFindManyMock,
  taskFindFirstMock,
  taskScheduleOccurrenceCountMock,
  taskScheduleOccurrenceFindManyMock,
  userFindUniqueMock,
  vendorGrantFindUniqueMock,
  resolveWorkspaceForContextMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskScheduleOccurrenceCountMock: vi.fn(),
  taskScheduleOccurrenceFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
  resolveWorkspaceForContextMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database/repositories")>()),
  workspaceRepository: {
    resolveWorkspaceForContext: (...args: unknown[]) =>
      resolveWorkspaceForContextMock(...args),
  },
}));

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

vi.mock(
  "@/helpers/coworker-user-context-binding",
  async () =>
    await vi.importActual<
      typeof import("@/helpers/coworker-user-context-binding")
    >("@/helpers/coworker-user-context-binding"),
);

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
      const { authContext } = c.var;
      if (!includeWorkspaceContext) {
        c.set("workspaceContext", null);
        return await next();
      }
      if (authContext.actor === "coworker") {
        c.set("workspaceContext", {
          workspaceId: "11111111-1111-7111-8111-111111111111",
          userId: "user_123",
          organizationId: null,
        });
        return await next();
      }
      if (authContext.actor === "user") {
        const workspaceContext = authContext.organizationId
          ? {
              workspaceId: "22222222-2222-7222-8222-222222222222",
              userId: null,
              organizationId: authContext.organizationId,
            }
          : {
              workspaceId: "11111111-1111-7111-8111-111111111111",
              userId: authContext.userId,
              organizationId: null,
            };
        c.set("workspaceContext", workspaceContext);
        return await next();
      }
      c.set("workspaceContext", null);
      return await next();
    },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: { findFirst: coworkerFindFirstMock },
    project: { findFirst: projectFindFirstMock },
    task: { findFirst: taskFindFirstMock, findMany: taskFindManyMock },
    taskScheduleOccurrence: {
      count: taskScheduleOccurrenceCountMock,
      findMany: taskScheduleOccurrenceFindManyMock,
    },
    user: { findUnique: userFindUniqueMock },
    vendorGrant: { findUnique: vendorGrantFindUniqueMock },
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
    coworkerFindFirstMock.mockResolvedValue({ id: "coworker_123" });
    projectFindFirstMock.mockResolvedValue({
      id: "22222222-2222-7222-8222-222222222222",
    });
    taskFindManyMock.mockResolvedValue([]);
    taskScheduleOccurrenceCountMock.mockResolvedValue(0);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
    userFindUniqueMock.mockResolvedValue({ email: "ada@nmkr.io" });
    vendorGrantFindUniqueMock.mockResolvedValue(null);
    resolveWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    taskFindFirstMock.mockResolvedValue(null);
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
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceWorkspaceId: "22222222-2222-7222-8222-222222222222",
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
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceWorkspaceId: "11111111-1111-7111-8111-111111111111",
        }),
      }),
    );
  });

  it("validates and filters the active workspace Calendar Project", async () => {
    const projectId = "22222222-2222-7222-8222-222222222222";
    const app = createApp({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
    projectFindFirstMock.mockResolvedValueOnce(null);

    const outsideWorkspaceResponse = await app.request(
      `http://localhost/calendar?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z&projectId=${projectId}`,
    );

    expect(outsideWorkspaceResponse.status).toBe(404);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();

    const response = await app.request(
      `http://localhost/calendar?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z&projectId=${projectId}`,
    );

    expect(response.status).toBe(200);
    expect(projectFindFirstMock).toHaveBeenLastCalledWith({
      where: {
        id: projectId,
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      select: { id: true },
    });
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceProjectId: projectId,
          sourceType: CalendarSourceType.PROJECT,
        }),
      }),
    );
  });

  it("filters the active workspace Calendar by its Workspace source", async () => {
    const response = await createApp({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    }).request(
      "http://localhost/calendar?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z&sourceId=workspace:11111111-1111-7111-8111-111111111111",
    );

    expect(response.status).toBe(200);
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceType: CalendarSourceType.WORKSPACE,
        }),
      }),
    );
  });

  it("allows a delegated coworker with a GRANTED workspace grant", async () => {
    vendorGrantFindUniqueMock.mockResolvedValue({
      id: "grant_123",
      status: VendorGrantStatus.GRANTED,
      permission: "workspace",
    });

    const response = await createApp({
      actor: "coworker",
      coworkerId: "coworker_123",
      vendorId: "vendor_123",
      context: {
        userId: "user_123",
        organizationId: null,
      },
    }).request(
      "http://localhost/calendar?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z",
    );

    expect(response.status).toBe(200);
    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "coworker_123",
        archivedAt: null,
        capabilities: { has: "tasks" },
      },
      select: {
        id: true,
        slug: true,
        baseURL: true,
      },
    });
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.any(Array),
        }),
      }),
    );
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it("allows a delegated coworker with a non-DRAFT baseline task", async () => {
    taskFindFirstMock.mockResolvedValue({ id: "task_123" });

    const response = await createApp({
      actor: "coworker",
      coworkerId: "coworker_123",
      vendorId: "vendor_123",
      context: { userId: "user_123", organizationId: null },
    }).request(
      "http://localhost/calendar?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z",
    );

    expect(response.status).toBe(200);
    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: TaskStatus.DRAFT } }),
      }),
    );
  });

  it("rejects a delegated coworker without a grant or baseline task", async () => {
    const response = await createApp({
      actor: "coworker",
      coworkerId: "coworker_123",
      vendorId: "vendor_123",
      context: { userId: "user_123", organizationId: null },
    }).request(
      "http://localhost/calendar?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z",
    );

    expect(response.status).toBe(403);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects a delegated coworker with a PENDING grant and no baseline task", async () => {
    vendorGrantFindUniqueMock.mockResolvedValue({
      id: "grant_123",
      status: VendorGrantStatus.PENDING,
      permission: "workspace",
    });

    const response = await createApp({
      actor: "coworker",
      coworkerId: "coworker_123",
      vendorId: "vendor_123",
      context: { userId: "user_123", organizationId: null },
    }).request(
      "http://localhost/calendar?from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z",
    );

    expect(response.status).toBe(403);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });
});
