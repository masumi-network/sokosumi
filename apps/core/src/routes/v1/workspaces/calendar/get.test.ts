import {
  CalendarSourceType,
  TaskScheduleOccurrenceState,
  TaskStatus,
  VendorGrantStatus,
} from "@sokosumi/database";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  coworkerFindFirstMock,
  memberFindFirstMock,
  projectFindFirstMock,
  taskFindManyMock,
  taskFindFirstMock,
  taskScheduleOccurrenceCountMock,
  taskScheduleOccurrenceFindManyMock,
  vendorGrantFindUniqueMock,
  resolveWorkspaceForContextMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskScheduleOccurrenceCountMock: vi.fn(),
  taskScheduleOccurrenceFindManyMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
  resolveWorkspaceForContextMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));

vi.mock(
  "@/helpers/coworker-user-context-binding",
  async () =>
    await vi.importActual<
      typeof import("@/helpers/coworker-user-context-binding")
    >("@/helpers/coworker-user-context-binding"),
);

vi.mock("@sokosumi/database/repositories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database/repositories")>()),
  workspaceRepository: {
    resolveWorkspaceForContext: (...args: unknown[]) =>
      resolveWorkspaceForContextMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: { findFirst: coworkerFindFirstMock },
    member: { findFirst: memberFindFirstMock },
    project: { findFirst: projectFindFirstMock },
    task: { findFirst: taskFindFirstMock, findMany: taskFindManyMock },
    taskScheduleOccurrence: {
      count: taskScheduleOccurrenceCountMock,
      findMany: taskScheduleOccurrenceFindManyMock,
    },
    vendorGrant: { findUnique: vendorGrantFindUniqueMock },
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
let readWorkspaceCalendar: typeof import("./read").readWorkspaceCalendar;

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_calendar");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: "user_123",
      organizationId: null,
    });
    return await next();
  });
  mountGetWorkspaceCalendar(app);
  return app;
}

function createLedgerOccurrence(overrides: Record<string, unknown> = {}) {
  const { seriesTask: seriesTaskOverride, ...occurrenceOverrides } = overrides;
  return {
    id: "00000000-0000-7000-8000-000000000001",
    scheduleVersion: 2,
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
      ownerId: "user_123",
      status: TaskStatus.QUEUED,
      assigneeId: null,
      assigneeUserId: null,
      metadata: JSON.stringify({ version: 2, mode: "recurring" }),
      scheduleRevision: 3,
      ...(seriesTaskOverride && typeof seriesTaskOverride === "object"
        ? seriesTaskOverride
        : {}),
    },
    ...occurrenceOverrides,
  };
}

function requestCalendar(
  app: OpenAPIHonoWithAuth,
  query = `from=${FROM}&to=${TO}`,
) {
  return app.request(`http://localhost/calendar?${query}`);
}

describe("GET /workspaces/calendar", () => {
  beforeAll(async () => {
    const routeModule = await import("./get");
    const readModule = await import("./read");
    mountGetWorkspaceCalendar = routeModule.default;
    readWorkspaceCalendar = readModule.readWorkspaceCalendar;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    coworkerFindFirstMock.mockResolvedValue({ id: "coworker_123" });
    projectFindFirstMock.mockResolvedValue({
      id: "22222222-2222-7222-8222-222222222222",
    });
    taskFindManyMock.mockReset();
    taskScheduleOccurrenceCountMock.mockReset();
    taskScheduleOccurrenceFindManyMock.mockReset();
    memberFindFirstMock.mockResolvedValue({ id: "member_123" });
    vendorGrantFindUniqueMock.mockResolvedValue(null);
    resolveWorkspaceForContextMock.mockResolvedValue({ id: WORKSPACE_ID });
    taskFindFirstMock.mockResolvedValue(null);
    taskFindManyMock.mockResolvedValue([]);
    taskScheduleOccurrenceCountMock.mockResolvedValue(0);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
  });

  it("returns calendar items for the caller personal workspace", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createLedgerOccurrence(),
    ]);
    taskScheduleOccurrenceCountMock.mockResolvedValue(1);

    const response = await requestCalendar(createApp());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "00000000-0000-7000-8000-000000000001",
          taskId: "tsk_history",
          taskName: "Released task",
          canEditSchedule: false,
          canMutateOccurrence: false,
          scheduleRevision: 3,
          taskStatus: "QUEUED",
          taskAssigneeId: null,
          taskAssigneeUserId: null,
          taskOwnerId: "user_123",
          scheduledAt: "2026-06-03T09:00:00.000Z",
          originalScheduledAt: "2026-06-03T09:00:00.000Z",
          state: "RELEASED",
          sourceId: "project:22222222-2222-7222-8222-222222222222",
          sourceWorkspaceId: WORKSPACE_ID,
          sourceType: "PROJECT",
          sourceProjectId: "22222222-2222-7222-8222-222222222222",
          sourceAccuracy: "INFERRED",
          timeAccuracy: "APPROXIMATE",
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
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("marks calendar items owned by another user as read-only", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createLedgerOccurrence({
        seriesTask: {
          id: "tsk_other",
          name: "Another user's task",
          ownerId: "user_456",
          status: TaskStatus.QUEUED,
          assigneeId: null,
          assigneeUserId: null,
          metadata: JSON.stringify({ version: 2, mode: "recurring" }),
          scheduleRevision: 3,
        },
      }),
    ]);

    const { items } = await readWorkspaceCalendar(WORKSPACE_ID, "user_123", {
      from: new Date(FROM),
      scope: "workspace",
      to: new Date(TO),
      cursor: null,
      requestedCursor: null,
      limit: 20,
    });

    expect(items).toEqual([
      expect.objectContaining({
        taskId: "tsk_other",
        canEditSchedule: false,
        canMutateOccurrence: false,
      }),
    ]);
  });

  it("marks an owner planned occurrence as editable", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createLedgerOccurrence({ state: TaskScheduleOccurrenceState.PLANNED }),
    ]);

    const { items } = await readWorkspaceCalendar(WORKSPACE_ID, "user_123", {
      from: new Date(FROM),
      scope: "workspace",
      to: new Date(TO),
      cursor: null,
      requestedCursor: null,
      limit: 20,
    });

    expect(items).toEqual([
      expect.objectContaining({
        taskId: "tsk_history",
        canEditSchedule: true,
        canMutateOccurrence: true,
        state: "PLANNED",
      }),
    ]);
  });

  it("returns an owner skipped occurrence as restorable", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createLedgerOccurrence({ state: TaskScheduleOccurrenceState.SKIPPED }),
    ]);

    const { items } = await readWorkspaceCalendar(WORKSPACE_ID, "user_123", {
      from: new Date(FROM),
      scope: "workspace",
      to: new Date(TO),
      cursor: null,
      requestedCursor: null,
      limit: 20,
    });

    expect(items).toEqual([
      expect.objectContaining({
        taskId: "tsk_history",
        canEditSchedule: true,
        canMutateOccurrence: true,
        state: "SKIPPED",
      }),
    ]);
  });

  it("rejects users outside the Calendar beta before reading calendar data", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    const response = await requestCalendar(createApp());

    expect(response.status).toBe(403);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("includes skipped and excludes canceled occurrences", async () => {
    const response = await requestCalendar(createApp());

    expect(response.status).toBe(200);
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: {
            in: [
              TaskScheduleOccurrenceState.PLANNED,
              TaskScheduleOccurrenceState.SKIPPED,
              TaskScheduleOccurrenceState.RELEASED,
            ],
          },
        }),
      }),
    );
    expect(taskScheduleOccurrenceCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        state: {
          in: [
            TaskScheduleOccurrenceState.PLANNED,
            TaskScheduleOccurrenceState.SKIPPED,
            TaskScheduleOccurrenceState.RELEASED,
          ],
        },
      }),
    });
  });

  it("queries only the selected Project calendar source", async () => {
    await readWorkspaceCalendar(
      WORKSPACE_ID,
      "user_123",
      {
        from: new Date(FROM),
        scope: "workspace",
        to: new Date(TO),
        cursor: null,
        requestedCursor: null,
        limit: 20,
      },
      { projectId: "22222222-2222-7222-8222-222222222222" },
    );

    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceProjectId: "22222222-2222-7222-8222-222222222222",
          sourceType: CalendarSourceType.PROJECT,
        }),
      }),
    );
    expect(taskScheduleOccurrenceCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        sourceProjectId: "22222222-2222-7222-8222-222222222222",
        sourceType: CalendarSourceType.PROJECT,
      }),
    });
  });

  it("filters workspace Calendar results to the requested Project source", async () => {
    const projectId = "22222222-2222-7222-8222-222222222222";

    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&projectId=${projectId}`,
    );

    expect(response.status).toBe(200);
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: { id: projectId, workspaceId: WORKSPACE_ID },
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
    expect(taskScheduleOccurrenceCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        sourceProjectId: projectId,
        sourceType: CalendarSourceType.PROJECT,
      }),
    });
  });

  it("filters workspace Calendar results to the requested legacy source", async () => {
    const sourceId = `legacy-unknown:${WORKSPACE_ID}`;

    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&sourceId=${sourceId}`,
    );

    expect(response.status).toBe(200);
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceType: CalendarSourceType.LEGACY_UNKNOWN,
        }),
      }),
    );
    expect(taskScheduleOccurrenceCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        sourceType: CalendarSourceType.LEGACY_UNKNOWN,
      }),
    });
  });

  it("rejects a source outside the requested workspace", async () => {
    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&sourceId=workspace:33333333-3333-7333-8333-333333333333`,
    );

    expect(response.status).toBe(404);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects requests that combine Project and source filters", async () => {
    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&projectId=22222222-2222-7222-8222-222222222222&sourceId=workspace:${WORKSPACE_ID}`,
    );

    expect(response.status).toBe(422);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects a Project outside the workspace", async () => {
    const projectId = "22222222-2222-7222-8222-222222222222";
    projectFindFirstMock.mockResolvedValue(null);

    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&projectId=${projectId}`,
    );

    expect(response.status).toBe(404);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("filters planned and released occurrences by owner, coworker, and status", async () => {
    const assigneeId = "22222222-2222-7222-8222-222222222222";
    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&scope=owned&assigneeId=${assigneeId}&status=READY`,
    );

    expect(response.status).toBe(200);
    const taskFilter = {
      ownerId: "user_123",
      assigneeId,
      status: TaskStatus.READY,
    };
    const occurrenceTaskFilter = {
      OR: [
        {
          state: {
            in: [
              TaskScheduleOccurrenceState.PLANNED,
              TaskScheduleOccurrenceState.SKIPPED,
            ],
          },
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
    };

    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([occurrenceTaskFilter]),
        }),
      }),
    );
    expect(taskScheduleOccurrenceCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([occurrenceTaskFilter]),
      }),
    });
  });

  it("limits a delegated coworker to Tasks it can read", async () => {
    vendorGrantFindUniqueMock.mockResolvedValue({
      id: "grant_123",
      status: VendorGrantStatus.GRANTED,
      permission: "workspace",
    });

    const response = await requestCalendar(createApp(COWORKER_AUTH_CONTEXT));

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
  });

  it("pages persisted occurrences in the requested range", async () => {
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
      expect.objectContaining({ take: expect.any(Number) }),
    );
  });

  it("uses the released Task as the Calendar navigation target", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createLedgerOccurrence({
        releasedTask: {
          id: "tsk_release",
          name: "Released task run",
          ownerId: "user_123",
          status: TaskStatus.COMPLETED,
          assigneeId: "coworker_123",
        },
      }),
    ]);
    taskScheduleOccurrenceCountMock.mockResolvedValue(1);

    const { items } = await readWorkspaceCalendar(WORKSPACE_ID, "user_123", {
      from: new Date(FROM),
      scope: "workspace",
      to: new Date(TO),
      cursor: null,
      requestedCursor: null,
      limit: 20,
    });

    expect(items).toEqual([
      expect.objectContaining({
        taskId: "tsk_release",
        taskName: "Released task run",
        taskStatus: TaskStatus.COMPLETED,
        taskAssigneeId: "coworker_123",
      }),
    ]);
  });

  it("does not use a projected item ID in the persisted occurrence cursor", async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        id: "v1:tsk_schedule:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
        scheduledAt: "2026-06-02T09:00:00.000Z",
      }),
      "utf8",
    ).toString("base64url");

    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&cursor=${cursor}`,
    );

    expect(response.status).toBe(200);
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: [
                {
                  effectiveScheduledAt: {
                    gt: new Date("2026-06-02T09:00:00.000Z"),
                  },
                },
              ],
            }),
          ]),
        }),
      }),
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
    [
      "range outside the rolling future horizon",
      "from=2099-06-01T00:00:00.000Z&to=2099-06-08T00:00:00.000Z",
      400,
    ],
  ])("rejects an %s", async (_name, query, status) => {
    const response = await requestCalendar(createApp(), query);

    expect(response.status).toBe(status);
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("returns indexed version 1 and version 2 plans", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createLedgerOccurrence({
        id: "00000000-0000-7000-8000-000000000010",
        scheduleVersion: 1,
        state: "PLANNED",
        sourceType: "WORKSPACE",
        sourceProjectId: null,
        seriesTask: {
          id: "tsk_v1",
          name: "Version 1 task",
          status: TaskStatus.QUEUED,
          assigneeId: null,
          metadata: JSON.stringify({
            version: 1,
            mode: "recurring",
            scheduledAt: "2026-06-01T09:00:00.000Z",
            expr: "0 9 * * *",
            timezone: "UTC",
            endsMode: "never",
          }),
        },
      }),
      createLedgerOccurrence({
        id: "00000000-0000-7000-8000-000000000011",
        state: "PLANNED",
        effectiveScheduledAt: new Date("2026-06-03T10:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
        seriesTask: {
          id: "tsk_v2",
          name: "Version 2 task",
          status: TaskStatus.QUEUED,
          assigneeId: null,
        },
      }),
      createLedgerOccurrence({
        id: "00000000-0000-7000-8000-000000000012",
        scheduleVersion: 1,
        state: "PLANNED",
        effectiveScheduledAt: new Date("2026-06-03T11:00:00.000Z"),
        seriesTask: {
          id: "tsk_v1_once",
          name: "Version 1 one-time task",
          status: TaskStatus.QUEUED,
          assigneeId: null,
          metadata: JSON.stringify({
            version: 1,
            mode: "once",
            scheduledAt: "2026-06-03T11:00:00.000Z",
            runAt: "2026-06-03T11:00:00.000Z",
          }),
        },
      }),
    ]);

    const response = await requestCalendar(createApp());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "tsk_v1",
          canMutateOccurrence: false,
          sourceType: "WORKSPACE",
        }),
        expect.objectContaining({
          taskId: "tsk_v2",
          canMutateOccurrence: true,
          scheduledAt: "2026-06-03T10:00:00.000Z",
          originalScheduledAt: "2026-06-03T09:00:00.000Z",
          sourceType: "PROJECT",
          sourceProjectId: "22222222-2222-7222-8222-222222222222",
        }),
        expect.objectContaining({
          taskId: "tsk_v1_once",
          canMutateOccurrence: true,
        }),
      ]),
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
        sourceId: "legacy-unknown:44444444-4444-7444-8444-444444444444",
        sourceWorkspaceId: "44444444-4444-7444-8444-444444444444",
        sourceType: "LEGACY_UNKNOWN",
        sourceProjectId: null,
        sourceAccuracy: "UNKNOWN",
        timeAccuracy: "APPROXIMATE",
      }),
    ]);
  });

  it("reads planned and released occurrences from the index without scanning tasks", async () => {
    taskFindManyMock.mockRejectedValue(
      new Error("calendar browse must not scan task schedules"),
    );
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createLedgerOccurrence({ state: "PLANNED" }),
      createLedgerOccurrence({
        id: "00000000-0000-7000-8000-000000000002",
        state: "RELEASED",
      }),
    ]);
    taskScheduleOccurrenceCountMock.mockResolvedValue(2);

    const response = await requestCalendar(createApp());

    expect(response.status).toBe(200);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        data: [
          expect.objectContaining({ state: "PLANNED" }),
          expect.objectContaining({ state: "RELEASED" }),
        ],
      }),
    );
  });

  it("uses indexed occurrence IDs for deterministic cursor pagination", async () => {
    taskScheduleOccurrenceFindManyMock
      .mockResolvedValueOnce([
        createLedgerOccurrence({
          id: "00000000-0000-7000-8000-000000000001",
          effectiveScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
          originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        }),
        createLedgerOccurrence({
          id: "00000000-0000-7000-8000-000000000002",
          effectiveScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
          originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        }),
        createLedgerOccurrence({
          id: "00000000-0000-7000-8000-000000000003",
          effectiveScheduledAt: new Date("2026-06-04T09:00:00.000Z"),
          originalScheduledAt: new Date("2026-06-04T09:00:00.000Z"),
        }),
      ])
      .mockResolvedValueOnce([
        createLedgerOccurrence({
          id: "00000000-0000-7000-8000-000000000003",
          effectiveScheduledAt: new Date("2026-06-04T09:00:00.000Z"),
          originalScheduledAt: new Date("2026-06-04T09:00:00.000Z"),
        }),
      ]);
    taskScheduleOccurrenceCountMock.mockResolvedValue(3);

    const firstResponse = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&limit=2`,
    );
    const firstPage = await firstResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstPage.data.map((item: { id: string }) => item.id)).toEqual([
      "00000000-0000-7000-8000-000000000001",
      "00000000-0000-7000-8000-000000000002",
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
      "00000000-0000-7000-8000-000000000003",
    ]);
    expect(secondPage.meta.pagination).toEqual({
      cursor: firstPage.meta.pagination.nextCursor,
      limit: 2,
      total: 3,
      nextCursor: null,
    });
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: [
                {
                  effectiveScheduledAt: {
                    gt: new Date("2026-06-02T09:00:00.000Z"),
                  },
                },
                {
                  effectiveScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
                  id: { gt: "00000000-0000-7000-8000-000000000002" },
                },
              ],
            }),
          ]),
        }),
      }),
    );
  });
});
