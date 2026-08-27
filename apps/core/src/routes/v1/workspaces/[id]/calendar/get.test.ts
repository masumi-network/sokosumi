import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  taskFindManyMock,
  taskScheduleOccurrenceFindManyMock,
  workspaceFindUniqueMock,
  resolveMemberOrganizationByIdMock,
} = vi.hoisted(() => ({
  taskFindManyMock: vi.fn(),
  taskScheduleOccurrenceFindManyMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
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

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findMany: taskFindManyMock },
    taskScheduleOccurrence: {
      findMany: taskScheduleOccurrenceFindManyMock,
    },
    workspace: { findUnique: workspaceFindUniqueMock },
  },
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: (...args: unknown[]) =>
    resolveMemberOrganizationByIdMock(...args),
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
  vendorId: "vendor_123",
  context: {
    userId: "user_123",
    organizationId: null,
  },
};

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const FROM = "2026-06-01T00:00:00.000Z";
const TO = "2026-06-08T00:00:00.000Z";

let mountGetWorkspaceCalendar: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  activeWorkspaceId?: string,
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_calendar");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    if (activeWorkspaceId) {
      c.set("workspaceContext", {
        workspaceId: activeWorkspaceId,
        userId: "user_123",
        organizationId: null,
      });
    }
    return await next();
  });
  mountGetWorkspaceCalendar(app);
  return app;
}

function createScheduledTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "tsk_schedule",
    name: "Schedule task",
    workspaceId: WORKSPACE_ID,
    projectId: null,
    assigneeId: null,
    status: TaskStatus.QUEUED,
    metadata: JSON.stringify({
      version: 1,
      mode: "once",
      scheduledAt: "2026-06-01T09:00:00.000Z",
      runAt: "2026-06-02T09:00:00.000Z",
    }),
    nextRunAt: new Date("2026-06-02T09:00:00.000Z"),
    ...overrides,
  };
}

function createLedgerOccurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    seriesTaskId: "tsk_history",
    originalScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
    effectiveScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
    state: "RELEASED",
    sourceWorkspaceId: WORKSPACE_ID,
    sourceType: "PROJECT",
    sourceProjectId: "22222222-2222-7222-8222-222222222222",
    sourceAccuracy: "INFERRED",
    timeAccuracy: "APPROXIMATE",
    seriesTask: {
      id: "tsk_history",
      name: "Released task",
      status: TaskStatus.QUEUED,
      assigneeId: null,
    },
    ...overrides,
  };
}

function requestCalendar(
  app: OpenAPIHonoWithAuth,
  query = `from=${FROM}&to=${TO}`,
) {
  return app.request(`http://localhost/${WORKSPACE_ID}/calendar?${query}`);
}

describe("GET /workspaces/{id}/calendar", () => {
  beforeAll(async () => {
    const module = await import("./get");
    mountGetWorkspaceCalendar = module.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    taskFindManyMock.mockResolvedValue([]);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
    workspaceFindUniqueMock.mockResolvedValue({
      userId: "user_123",
      organizationId: null,
    });
  });

  it("returns calendar items for the caller personal workspace", async () => {
    taskFindManyMock.mockResolvedValue([createScheduledTask()]);

    const response = await requestCalendar(createApp());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "v1:tsk_schedule:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
          taskId: "tsk_schedule",
          taskName: "Schedule task",
          taskStatus: "QUEUED",
          taskAssigneeId: null,
          scheduledAt: "2026-06-02T09:00:00.000Z",
          originalScheduledAt: "2026-06-02T09:00:00.000Z",
          state: "PLANNED",
          sourceWorkspaceId: WORKSPACE_ID,
          sourceType: "WORKSPACE",
          sourceProjectId: null,
          sourceAccuracy: "EXACT",
          timeAccuracy: "EXACT",
        },
      ],
      meta: expect.objectContaining({
        requestId: "req_calendar",
        pagination: {
          cursor: null,
          limit: 20,
          total: 1,
          nextCursor: null,
        },
      }),
    });
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("allows a member to read an organization workspace calendar", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      userId: null,
      organizationId: "org_123",
    });
    resolveMemberOrganizationByIdMock.mockResolvedValue({ id: "org_123" });

    const response = await requestCalendar(createApp());

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith({
      id: "org_123",
      userId: "user_123",
      tx: expect.anything(),
    });
  });

  it("rejects a user who does not own the personal workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      userId: "user_other",
      organizationId: null,
    });

    const response = await requestCalendar(createApp());

    expect(response.status).toBe(403);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects a delegated coworker reading outside its active workspace", async () => {
    const response = await requestCalendar(
      createApp(COWORKER_AUTH_CONTEXT, "22222222-2222-7222-8222-222222222222"),
    );

    expect(response.status).toBe(403);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("reads all scheduled sources in the requested range", async () => {
    taskFindManyMock.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) =>
        createScheduledTask({ id: `tsk_schedule_${index}` }),
      ),
    );

    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&limit=1`,
    );

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ take: expect.anything() }),
    );
  });

  it("reads all persisted occurrences in the requested range", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) =>
        createLedgerOccurrence({
          id: `00000000-0000-7000-8000-${String(index).padStart(12, "0")}`,
        }),
      ),
    );

    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&limit=1`,
    );

    expect(response.status).toBe(200);
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ take: expect.anything() }),
    );
  });

  it.each([
    ["invalid datetime", "from=not-a-date&to=2026-06-08T00:00:00.000Z", 422],
    [
      "empty range",
      "from=2026-06-08T00:00:00.000Z&to=2026-06-08T00:00:00.000Z",
      400,
    ],
    [
      "range over 90 days",
      "from=2026-06-01T00:00:00.000Z&to=2026-08-31T00:00:00.001Z",
      400,
    ],
  ])("rejects an %s", async (_name, query, status) => {
    const response = await requestCalendar(createApp(), query);

    expect(response.status).toBe(status);
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("projects valid version 1 and version 2 schedules", async () => {
    taskFindManyMock.mockResolvedValue([
      createScheduledTask({
        metadata: JSON.stringify({
          version: 1,
          mode: "recurring",
          scheduledAt: "2026-06-01T09:00:00.000Z",
          expr: "0 9 * * *",
          timezone: "UTC",
          endsMode: "never",
        }),
      }),
      createScheduledTask({
        id: "tsk_v2",
        name: "Version 2 task",
        projectId: "22222222-2222-7222-8222-222222222222",
        metadata: JSON.stringify({
          version: 2,
          epochId: "33333333-3333-7333-8333-333333333333",
          mode: "once",
          createdAt: "2026-06-01T08:00:00.000Z",
          ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
          timezone: "UTC",
          sourceRunAt: "2026-06-03T09:00:00.000Z",
          effectiveRunAt: "2026-06-03T10:00:00.000Z",
        }),
        nextRunAt: new Date("2026-06-03T10:00:00.000Z"),
      }),
    ]);

    const response = await requestCalendar(createApp());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "v1:tsk_schedule:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
          taskId: "tsk_schedule",
          sourceType: "WORKSPACE",
        }),
        expect.objectContaining({
          id: "v2:33333333-3333-7333-8333-333333333333:2026-06-03T09:00:00.000Z",
          taskId: "tsk_v2",
          scheduledAt: "2026-06-03T10:00:00.000Z",
          originalScheduledAt: "2026-06-03T09:00:00.000Z",
          sourceType: "PROJECT",
          sourceProjectId: "22222222-2222-7222-8222-222222222222",
        }),
      ]),
    );
  });

  it("omits malformed and quarantined schedules", async () => {
    taskFindManyMock.mockResolvedValue([
      createScheduledTask({ id: "tsk_malformed", metadata: "not json" }),
    ]);

    const response = await requestCalendar(createApp());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scheduleQuarantine: null }),
      }),
    );
  });

  it("returns persisted ledger source and time accuracy without recalculating it", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createLedgerOccurrence({
        sourceWorkspaceId: "44444444-4444-7444-8444-444444444444",
        sourceType: "LEGACY_UNKNOWN",
        sourceProjectId: null,
        sourceAccuracy: "UNKNOWN",
        timeAccuracy: "APPROXIMATE",
      }),
    ]);

    const response = await requestCalendar(createApp());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "00000000-0000-7000-8000-000000000001",
        taskId: "tsk_history",
        taskName: "Released task",
        sourceWorkspaceId: "44444444-4444-7444-8444-444444444444",
        sourceType: "LEGACY_UNKNOWN",
        sourceProjectId: null,
        sourceAccuracy: "UNKNOWN",
        timeAccuracy: "APPROXIMATE",
      }),
    ]);
  });

  it("sorts mixed projections and ledger rows deterministically across cursor pages", async () => {
    taskFindManyMock.mockResolvedValue([
      createScheduledTask(),
      createScheduledTask({
        id: "tsk_later",
        name: "Later task",
        metadata: JSON.stringify({
          version: 1,
          mode: "once",
          scheduledAt: "2026-06-01T09:00:00.000Z",
          runAt: "2026-06-04T09:00:00.000Z",
        }),
        nextRunAt: new Date("2026-06-04T09:00:00.000Z"),
      }),
    ]);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createLedgerOccurrence({
        effectiveScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
      }),
    ]);

    const firstResponse = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&limit=2`,
    );
    const firstPage = await firstResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstPage.data.map((item: { id: string }) => item.id)).toEqual([
      "00000000-0000-7000-8000-000000000001",
      "v1:tsk_schedule:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
    ]);
    expect(firstPage.meta.pagination.nextCursor).toEqual(expect.any(String));

    const secondResponse = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&limit=2&cursor=${encodeURIComponent(firstPage.meta.pagination.nextCursor)}`,
    );
    expect(secondResponse.status).toBe(200);
    const secondPage = await secondResponse.json();

    if (secondResponse.status !== 200) {
      throw new Error(await secondResponse.text());
    }
    expect(secondPage.data.map((item: { id: string }) => item.id)).toEqual([
      "v1:tsk_later:2026-06-01T09:00:00.000Z:2026-06-04T09:00:00.000Z",
    ]);
    expect(secondPage.meta.pagination).toEqual({
      cursor: firstPage.meta.pagination.nextCursor,
      limit: 2,
      total: 3,
      nextCursor: null,
    });
  });

  it("keeps same-time version 1 projections on separate cursor pages", async () => {
    taskFindManyMock.mockResolvedValue([
      createScheduledTask(),
      createScheduledTask({ id: "tsk_collision" }),
    ]);

    const firstResponse = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&limit=1`,
    );
    const firstPage = await firstResponse.json();
    const secondResponse = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&limit=1&cursor=${encodeURIComponent(firstPage.meta.pagination.nextCursor)}`,
    );
    expect(secondResponse.status).toBe(200);
    const secondPage = await secondResponse.json();

    expect(firstPage.data.map((item: { id: string }) => item.id)).toEqual([
      "v1:tsk_collision:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
    ]);
    expect(secondPage.data.map((item: { id: string }) => item.id)).toEqual([
      "v1:tsk_schedule:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
    ]);
  });
});
