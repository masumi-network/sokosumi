import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  requireCoworkerCapabilityMock,
  taskScheduleOccurrenceCountMock,
  taskScheduleOccurrenceFindManyMock,
  vendorGrantFindUniqueMock,
} = vi.hoisted(() => ({
  requireCoworkerCapabilityMock: vi.fn(),
  taskScheduleOccurrenceCountMock: vi.fn(),
  taskScheduleOccurrenceFindManyMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskScheduleOccurrence: {
      count: taskScheduleOccurrenceCountMock,
      findMany: taskScheduleOccurrenceFindManyMock,
    },
    vendorGrant: { findUnique: vendorGrantFindUniqueMock },
  },
}));

vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: async (authContext: AuthenticationContext) => {
    if (authContext.actor === "user") {
      return { source: "session" as const, ...authContext };
    }
    if (authContext.actor === "coworker" && authContext.context) {
      return { source: "context" as const, ...authContext.context };
    }
    throw new HTTPException(403, { message: "User authentication required" });
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_123",
  vendorId: "01960001-0001-7001-8001-000000000001",
  context: {
    userId: "user_123",
    organizationId: "org_123",
  },
};

const WORKSPACE_ID = "22222222-2222-7222-8222-222222222222";
const FROM = "2026-06-01T00:00:00.000Z";
const TO = "2026-06-08T00:00:00.000Z";

const COWORKER_SIBLING_LIST_FILTER = {
  status: { not: TaskStatus.DRAFT },
  OR: [
    { assigneeId: "coworker_123" },
    {
      assigneeId: { not: "coworker_123" },
      assignee: {
        vendorId: "01960001-0001-7001-8001-000000000001",
      },
    },
  ],
} as const;

let mountGetActiveWorkspaceCalendar: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_active_calendar");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: authContext.actor === "user" ? authContext.userId : "user_123",
      organizationId:
        authContext.actor === "coworker"
          ? (authContext.context?.organizationId ?? null)
          : authContext.organizationId,
    });
    return await next();
  });
  mountGetActiveWorkspaceCalendar(app);
  return app;
}

describe("GET /workspaces/calendar", () => {
  beforeAll(async () => {
    const module = await import("./get");
    mountGetActiveWorkspaceCalendar = module.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
    vendorGrantFindUniqueMock.mockResolvedValue(null);
    taskScheduleOccurrenceCountMock.mockResolvedValue(0);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
  });

  it("does not apply coworker task access when a human reads the workspace calendar", async () => {
    const response = await createApp().request(
      `http://localhost/calendar?from=${FROM}&to=${TO}`,
    );

    expect(response.status).toBe(200);
    expect(requireCoworkerCapabilityMock).not.toHaveBeenCalled();
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          seriesTask: expect.anything(),
        }),
      }),
    );
  });

  it("scopes calendar occurrences to coworker task access", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      `http://localhost/calendar?from=${FROM}&to=${TO}`,
    );

    expect(response.status).toBe(200);
    expect(requireCoworkerCapabilityMock).toHaveBeenCalledWith(
      "coworker_123",
      "tasks",
    );
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceWorkspaceId: WORKSPACE_ID,
          seriesTask: {
            AND: [COWORKER_SIBLING_LIST_FILTER],
          },
        }),
      }),
    );
  });
});
