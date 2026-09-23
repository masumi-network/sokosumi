import {
  CalendarSourceType,
  TaskScheduleOccurrenceState,
  TaskScheduleState,
  TaskStatus,
  TaskVisibility,
  VendorGrantStatus,
} from "@sokosumi/database";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  coworkerFindFirstMock,
  memberFindFirstMock,
  projectFindFirstMock,
  taskScheduleOccurrenceCountMock,
  taskScheduleOccurrenceFindManyMock,
  vendorGrantFindUniqueMock,
  resolveWorkspaceForContextMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
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
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const SCHEDULE_ID = "33333333-3333-7333-8333-333333333333";
const NOW = new Date("2026-06-01T12:00:00.000Z");
const FROM = "2026-06-01T00:00:00.000Z";
const TO = "2026-06-08T00:00:00.000Z";

const HUMAN_VISIBILITY = {
  OR: [
    { visibility: TaskVisibility.PUBLIC },
    { visibility: TaskVisibility.PRIVATE, ownerId: "user_123" },
  ],
};

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

function createRun(overrides: Record<string, unknown> = {}) {
  const { schedule: scheduleOverride, ...runOverrides } = overrides;
  return {
    id: "00000000-0000-7000-8000-000000000001",
    scheduleId: SCHEDULE_ID,
    originalScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
    effectiveScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
    state: TaskScheduleOccurrenceState.PLANNED,
    sourceWorkspaceId: WORKSPACE_ID,
    sourceType: CalendarSourceType.PROJECT,
    sourceProjectId: PROJECT_ID,
    sourceAccuracy: "EXACT",
    timeAccuracy: "EXACT",
    schedule: {
      id: SCHEDULE_ID,
      name: "Weekly report",
      ownerId: "user_123",
      state: TaskScheduleState.ACTIVE,
      revision: 4,
      assigneeId: "coworker_123",
      assigneeUserId: null,
      ...(scheduleOverride && typeof scheduleOverride === "object"
        ? scheduleOverride
        : {}),
    },
    releasedTask: null,
    ...runOverrides,
  };
}

const RELEASED_TASK = {
  id: "tsk_created",
  name: "Weekly report (June 3)",
  ownerId: "user_123",
  status: TaskStatus.COMPLETED,
  assigneeId: "coworker_456",
  assigneeUserId: null,
};

const QUERY = {
  from: new Date(FROM),
  scope: "workspace" as const,
  to: new Date(TO),
  cursor: null,
  requestedCursor: null,
  limit: 20,
};

function requestCalendar(
  app: OpenAPIHonoWithAuth,
  query = `from=${FROM}&to=${TO}`,
) {
  return app.request(`http://localhost/calendar?${query}`);
}

function lastRunWhere() {
  return taskScheduleOccurrenceFindManyMock.mock.lastCall?.[0].where;
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    coworkerFindFirstMock.mockResolvedValue({ id: "coworker_123" });
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    memberFindFirstMock.mockResolvedValue({ id: "member_123" });
    vendorGrantFindUniqueMock.mockResolvedValue(null);
    resolveWorkspaceForContextMock.mockResolvedValue({ id: WORKSPACE_ID });
    taskScheduleOccurrenceCountMock.mockResolvedValue(0);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an upcoming Task Schedule Run in range", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([createRun()]);
    taskScheduleOccurrenceCountMock.mockResolvedValue(1);

    const response = await requestCalendar(createApp());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "00000000-0000-7000-8000-000000000001",
          scheduleId: SCHEDULE_ID,
          scheduleRevision: 4,
          canChangeRun: true,
          taskId: null,
          taskName: "Weekly report",
          taskStatus: null,
          taskAssigneeId: "coworker_123",
          taskAssigneeUserId: null,
          taskOwnerId: "user_123",
          scheduledAt: "2026-06-03T09:00:00.000Z",
          originalScheduledAt: "2026-06-03T09:00:00.000Z",
          state: "PLANNED",
          sourceId: `project:${PROJECT_ID}`,
          sourceWorkspaceId: WORKSPACE_ID,
          sourceType: "PROJECT",
          sourceProjectId: PROJECT_ID,
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
  });

  it("reads only Task Schedule Runs in the range, without skipped or canceled ones", async () => {
    await requestCalendar(createApp());

    expect(lastRunWhere()).toEqual(
      expect.objectContaining({
        scheduleId: { not: null },
        sourceWorkspaceId: WORKSPACE_ID,
        state: {
          in: [
            TaskScheduleOccurrenceState.PLANNED,
            TaskScheduleOccurrenceState.RELEASED,
          ],
        },
        effectiveScheduledAt: { gte: new Date(FROM), lt: new Date(TO) },
      }),
    );
    expect(taskScheduleOccurrenceCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        scheduleId: { not: null },
        state: {
          in: [
            TaskScheduleOccurrenceState.PLANNED,
            TaskScheduleOccurrenceState.RELEASED,
          ],
        },
      }),
    });
  });

  it("shows planned Runs of Active schedules the caller can see, and released ones through their Task", async () => {
    await requestCalendar(createApp());

    expect(lastRunWhere().AND).toEqual([
      {
        OR: [
          {
            state: TaskScheduleOccurrenceState.PLANNED,
            schedule: {
              is: {
                AND: [{ state: TaskScheduleState.ACTIVE }, HUMAN_VISIBILITY],
              },
            },
          },
          {
            state: TaskScheduleOccurrenceState.RELEASED,
            releasedTask: {
              is: { AND: [{ archivedAt: null }, HUMAN_VISIBILITY] },
            },
          },
        ],
      },
    ]);
  });

  it("shows a moved Run at its new time and lets the owner restore it", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createRun({
        effectiveScheduledAt: new Date("2026-06-04T15:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
      }),
    ]);

    const { items } = await readWorkspaceCalendar(
      WORKSPACE_ID,
      "user_123",
      QUERY,
    );

    expect(items).toEqual([
      expect.objectContaining({
        scheduledAt: "2026-06-04T15:00:00.000Z",
        originalScheduledAt: "2026-06-03T09:00:00.000Z",
        canChangeRun: true,
      }),
    ]);
  });

  it("uses the created Task for a released Run, which can no longer change", async () => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createRun({
        state: TaskScheduleOccurrenceState.RELEASED,
        releasedTask: RELEASED_TASK,
      }),
    ]);

    const { items } = await readWorkspaceCalendar(
      WORKSPACE_ID,
      "user_123",
      QUERY,
    );

    expect(items).toEqual([
      expect.objectContaining({
        scheduleId: SCHEDULE_ID,
        taskId: "tsk_created",
        taskName: "Weekly report (June 3)",
        taskStatus: TaskStatus.COMPLETED,
        taskAssigneeId: "coworker_456",
        state: "RELEASED",
        canChangeRun: false,
      }),
    ]);
  });

  it.each([
    ["another member's schedule", { schedule: { ownerId: "user_456" } }],
    [
      "a Run already due",
      { effectiveScheduledAt: new Date("2026-06-01T11:00:00.000Z") },
    ],
    ["a paused schedule", { schedule: { state: TaskScheduleState.PAUSED } }],
  ])("does not offer changes to %s", async (_name, overrides) => {
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([
      createRun(overrides),
    ]);

    const { items } = await readWorkspaceCalendar(
      WORKSPACE_ID,
      "user_123",
      QUERY,
    );

    expect(items).toEqual([expect.objectContaining({ canChangeRun: false })]);
  });

  it("applies owner and assignee filters to schedules and created Tasks", async () => {
    await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&scope=owned&assigneeId=${PROJECT_ID}`,
    );

    const filter = { ownerId: "user_123", assigneeId: PROJECT_ID };
    expect(lastRunWhere().AND).toEqual([
      {
        OR: [
          {
            state: TaskScheduleOccurrenceState.PLANNED,
            schedule: {
              is: {
                AND: [
                  { state: TaskScheduleState.ACTIVE },
                  HUMAN_VISIBILITY,
                  filter,
                ],
              },
            },
          },
          {
            state: TaskScheduleOccurrenceState.RELEASED,
            releasedTask: {
              is: { AND: [{ archivedAt: null }, HUMAN_VISIBILITY, filter] },
            },
          },
        ],
      },
    ]);
  });

  it("keeps only Runs whose created Task has the requested status", async () => {
    await requestCalendar(createApp(), `from=${FROM}&to=${TO}&status=READY`);

    expect(lastRunWhere().AND).toEqual([
      {
        OR: [
          {
            state: TaskScheduleOccurrenceState.RELEASED,
            releasedTask: {
              is: {
                AND: [
                  { archivedAt: null },
                  HUMAN_VISIBILITY,
                  { status: TaskStatus.READY },
                ],
              },
            },
          },
        ],
      },
    ]);
  });

  it("limits a delegated coworker to schedules and Tasks it can read", async () => {
    vendorGrantFindUniqueMock.mockResolvedValue({
      id: "grant_123",
      status: VendorGrantStatus.GRANTED,
      permission: "workspace",
    });

    const response = await requestCalendar(createApp(COWORKER_AUTH_CONTEXT));

    expect(response.status).toBe(200);
    const coworkerVisibility = {
      OR: [
        { visibility: TaskVisibility.PUBLIC },
        { visibility: TaskVisibility.PRIVATE, assigneeId: "coworker_123" },
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: { not: "coworker_123" },
          assignee: { vendorId: "vendor_123" },
        },
      ],
    };
    expect(lastRunWhere().AND).toEqual([
      {
        OR: [
          {
            state: TaskScheduleOccurrenceState.PLANNED,
            schedule: {
              is: {
                AND: [{ state: TaskScheduleState.ACTIVE }, coworkerVisibility],
              },
            },
          },
          {
            state: TaskScheduleOccurrenceState.RELEASED,
            releasedTask: {
              is: {
                AND: [
                  { archivedAt: null },
                  {
                    archivedAt: null,
                    status: { not: TaskStatus.DRAFT },
                    ...coworkerVisibility,
                  },
                ],
              },
            },
          },
        ],
      },
    ]);
  });

  it("rejects users outside the Calendar beta before reading calendar data", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    const response = await requestCalendar(createApp());

    expect(response.status).toBe(403);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("filters workspace Calendar results to the requested Project source", async () => {
    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&projectId=${PROJECT_ID}`,
    );

    expect(response.status).toBe(200);
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      select: { id: true },
    });
    expect(lastRunWhere()).toEqual(
      expect.objectContaining({
        sourceProjectId: PROJECT_ID,
        sourceType: CalendarSourceType.PROJECT,
      }),
    );
    expect(taskScheduleOccurrenceCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        sourceProjectId: PROJECT_ID,
        sourceType: CalendarSourceType.PROJECT,
      }),
    });
  });

  it("filters workspace Calendar results to the workspace source", async () => {
    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&sourceId=workspace:${WORKSPACE_ID}`,
    );

    expect(response.status).toBe(200);
    expect(lastRunWhere()).toEqual(
      expect.objectContaining({ sourceType: CalendarSourceType.WORKSPACE }),
    );
  });

  it("rejects a source outside the requested workspace", async () => {
    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&sourceId=workspace:44444444-4444-7444-8444-444444444444`,
    );

    expect(response.status).toBe(404);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects requests that combine Project and source filters", async () => {
    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&projectId=${PROJECT_ID}&sourceId=workspace:${WORKSPACE_ID}`,
    );

    expect(response.status).toBe(422);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects a Project outside the workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    const response = await requestCalendar(
      createApp(),
      `from=${FROM}&to=${TO}&projectId=${PROJECT_ID}`,
    );

    expect(response.status).toBe(404);
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
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
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("pages Runs by time and id with a stable cursor", async () => {
    taskScheduleOccurrenceFindManyMock
      .mockResolvedValueOnce([
        createRun({
          id: "00000000-0000-7000-8000-000000000001",
          effectiveScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
          originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        }),
        createRun({
          id: "00000000-0000-7000-8000-000000000002",
          effectiveScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
          originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        }),
        createRun({
          id: "00000000-0000-7000-8000-000000000003",
          effectiveScheduledAt: new Date("2026-06-04T09:00:00.000Z"),
          originalScheduledAt: new Date("2026-06-04T09:00:00.000Z"),
        }),
      ])
      .mockResolvedValueOnce([
        createRun({
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
    const secondPage = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondPage.data.map((item: { id: string }) => item.id)).toEqual([
      "00000000-0000-7000-8000-000000000003",
    ]);
    expect(secondPage.meta.pagination).toEqual({
      cursor: firstPage.meta.pagination.nextCursor,
      limit: 2,
      total: 3,
      nextCursor: null,
    });
    expect(lastRunWhere().AND).toEqual(
      expect.arrayContaining([
        {
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
        },
      ]),
    );
  });
});
