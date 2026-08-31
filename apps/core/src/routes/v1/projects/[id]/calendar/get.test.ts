import { TaskScheduleOccurrenceState, TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  coworkerFindFirstMock,
  projectFindFirstMock,
  taskScheduleOccurrenceCountMock,
  taskScheduleOccurrenceFindManyMock,
  userFindUniqueMock,
  vendorGrantFindUniqueMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  taskScheduleOccurrenceCountMock: vi.fn(),
  taskScheduleOccurrenceFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
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

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: { findFirst: coworkerFindFirstMock },
    project: { findFirst: projectFindFirstMock },
    taskScheduleOccurrence: {
      count: taskScheduleOccurrenceCountMock,
      findMany: taskScheduleOccurrenceFindManyMock,
    },
    user: { findUnique: userFindUniqueMock },
    vendorGrant: { findUnique: vendorGrantFindUniqueMock },
  },
}));

const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const FROM = "2026-06-01T00:00:00.000Z";
const TO = "2026-06-08T00:00:00.000Z";

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_123",
  vendorId: "vendor_123",
  context: {
    userId: "user_123",
    organizationId: null,
  },
};

let mountGetProjectCalendar: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_project_calendar");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: "user_123",
      organizationId: null,
    });
    return await next();
  });
  app.onError(errorHandler);
  mountGetProjectCalendar(app);
  return app;
}

function createOccurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    seriesTaskId: "task_123",
    originalScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
    effectiveScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
    state: TaskScheduleOccurrenceState.RELEASED,
    sourceWorkspaceId: WORKSPACE_ID,
    sourceType: "PROJECT",
    sourceProjectId: PROJECT_ID,
    sourceAccuracy: "INFERRED",
    timeAccuracy: "APPROXIMATE",
    epochId: null,
    seriesTask: {
      id: "task_123",
      name: "Prepare release notes",
      status: TaskStatus.QUEUED,
      assigneeId: null,
    },
    ...overrides,
  };
}

describe("GET /projects/{id}/calendar", () => {
  beforeAll(async () => {
    const module = await import("./get");
    mountGetProjectCalendar = module.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    userFindUniqueMock.mockResolvedValue({ email: "ada@nmkr.io" });
    taskScheduleOccurrenceCountMock.mockResolvedValue(1);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([createOccurrence()]);
    coworkerFindFirstMock.mockResolvedValue({ id: "coworker_123" });
    vendorGrantFindUniqueMock.mockResolvedValue(null);
  });

  it("returns only occurrences attributed to the route Project", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/calendar?from=${FROM}&to=${TO}`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            sourceProjectId: PROJECT_ID,
            sourceType: "PROJECT",
            sourceAccuracy: "INFERRED",
          }),
        ],
      }),
    );
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceProjectId: PROJECT_ID,
          sourceType: "PROJECT",
        }),
      }),
    );
  });

  it("filters planned and released Project occurrences by task status", async () => {
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/calendar?from=${FROM}&to=${TO}&status=READY`,
    );

    expect(response.status).toBe(200);
    const taskFilter = { status: TaskStatus.READY };
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                {
                  state: TaskScheduleOccurrenceState.PLANNED,
                  seriesTask: { is: taskFilter },
                },
                {
                  state: TaskScheduleOccurrenceState.RELEASED,
                  releasedTask: { is: taskFilter },
                },
                {
                  state: TaskScheduleOccurrenceState.RELEASED,
                  releasedTaskId: null,
                  seriesTask: { is: taskFilter },
                },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("does not read schedule data when the Project is outside the workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/calendar?from=${FROM}&to=${TO}`,
    );

    expect(response.status).toBe(404);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("limits a delegated coworker to Tasks it can read", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      `http://localhost/${PROJECT_ID}/calendar?from=${FROM}&to=${TO}`,
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
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  state: TaskScheduleOccurrenceState.PLANNED,
                  seriesTask: {
                    is: expect.objectContaining({
                      archivedAt: null,
                      status: { not: TaskStatus.DRAFT },
                    }),
                  },
                }),
                expect.objectContaining({
                  state: TaskScheduleOccurrenceState.RELEASED,
                  releasedTask: {
                    is: expect.objectContaining({
                      archivedAt: null,
                      status: { not: TaskStatus.DRAFT },
                    }),
                  },
                }),
              ]),
            }),
          ]),
        }),
      }),
    );
    expect(taskScheduleOccurrenceCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.any(Array),
        }),
      }),
    );
  });
});
