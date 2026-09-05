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
  taskFindManyMock,
  taskFindFirstMock,
  taskScheduleOccurrenceCountMock,
  taskScheduleOccurrenceFindManyMock,
  userFindUniqueMock,
  vendorGrantFindUniqueMock,
  resolveWorkspaceForContextMock,
  workspaceFindUniqueMock,
  resolveMemberOrganizationByIdMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskScheduleOccurrenceCountMock: vi.fn(),
  taskScheduleOccurrenceFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  vendorGrantFindUniqueMock: vi.fn(),
  resolveWorkspaceForContextMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
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
    task: { findFirst: taskFindFirstMock, findMany: taskFindManyMock },
    taskScheduleOccurrence: {
      count: taskScheduleOccurrenceCountMock,
      findMany: taskScheduleOccurrenceFindManyMock,
    },
    user: { findUnique: userFindUniqueMock },
    vendorGrant: { findUnique: vendorGrantFindUniqueMock },
    workspace: { findUnique: workspaceFindUniqueMock },
  },
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: (...args: unknown[]) =>
    resolveMemberOrganizationByIdMock(...args),
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
let readWorkspaceCalendar: typeof import("./get").readWorkspaceCalendar;

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
    readWorkspaceCalendar = module.readWorkspaceCalendar;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    coworkerFindFirstMock.mockResolvedValue({ id: "coworker_123" });
    taskFindManyMock.mockReset();
    taskScheduleOccurrenceCountMock.mockReset();
    taskScheduleOccurrenceFindManyMock.mockReset();
    userFindUniqueMock.mockResolvedValue({ email: "ada@nmkr.io" });
    vendorGrantFindUniqueMock.mockResolvedValue(null);
    resolveWorkspaceForContextMock.mockResolvedValue({ id: WORKSPACE_ID });
    taskFindFirstMock.mockResolvedValue(null);
    taskFindManyMock.mockResolvedValue([]);
    taskScheduleOccurrenceCountMock.mockResolvedValue(0);
    taskScheduleOccurrenceFindManyMock.mockResolvedValue([]);
    workspaceFindUniqueMock.mockResolvedValue({
      userId: "user_123",
      organizationId: null,
    });
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
          taskStatus: "QUEUED",
          taskAssigneeId: null,
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
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects non-NMKR users before reading calendar data", async () => {
    userFindUniqueMock.mockResolvedValue({ email: "ada@example.com" });

    const response = await requestCalendar(createApp());

    expect(response.status).toBe(403);
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    expect(taskScheduleOccurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("excludes skipped and canceled occurrences", async () => {
    const response = await requestCalendar(createApp());

    expect(response.status).toBe(200);
    expect(taskScheduleOccurrenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: {
            in: [
              TaskScheduleOccurrenceState.PLANNED,
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

  it("limits a delegated coworker to Tasks it can read", async () => {
    vendorGrantFindUniqueMock.mockResolvedValue({
      id: "grant_123",
      status: VendorGrantStatus.GRANTED,
      permission: "workspace",
    });

    const response = await requestCalendar(
      createApp(COWORKER_AUTH_CONTEXT, WORKSPACE_ID),
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
        state: "PLANNED",
        sourceType: "WORKSPACE",
        sourceProjectId: null,
        seriesTask: {
          id: "tsk_v1",
          name: "Version 1 task",
          status: TaskStatus.QUEUED,
          assigneeId: null,
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
    ]);

    const response = await requestCalendar(createApp());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "tsk_v1",
          sourceType: "WORKSPACE",
        }),
        expect.objectContaining({
          taskId: "tsk_v2",
          scheduledAt: "2026-06-03T10:00:00.000Z",
          originalScheduledAt: "2026-06-03T09:00:00.000Z",
          sourceType: "PROJECT",
          sourceProjectId: "22222222-2222-7222-8222-222222222222",
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
