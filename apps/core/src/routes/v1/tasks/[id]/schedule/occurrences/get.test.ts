import {
  CalendarSourceAccuracy,
  CalendarSourceType,
  CalendarTimeAccuracy,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountGetTaskScheduleOccurrences, {
  encodeTaskScheduleOccurrenceCursor,
} from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  memberFindFirstMock,
  requireTaskCollaborationMock,
  occurrenceCountMock,
  occurrenceFindManyMock,
} = vi.hoisted(() => ({
  memberFindFirstMock: vi.fn(),
  requireTaskCollaborationMock: vi.fn(),
  occurrenceCountMock: vi.fn(),
  occurrenceFindManyMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCollaboration: requireTaskCollaborationMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    member: { findFirst: memberFindFirstMock },
    taskScheduleOccurrence: {
      count: occurrenceCountMock,
      findMany: occurrenceFindManyMock,
    },
  },
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const EPOCH_ID = "44444444-4444-7444-8444-444444444444";
const TASK_ID = "tsk_123";
const NOW = new Date("2026-06-10T00:00:00.000Z");

function createApp(
  authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: "org_123",
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_schedule_occurrences_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });

  app.onError(errorHandler);
  mountGetTaskScheduleOccurrences(app);
  return app;
}

function request(query = "") {
  return `http://localhost/${TASK_ID}/schedule/occurrences${query}`;
}

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-7333-8333-333333333331",
    state: TaskScheduleOccurrenceState.PLANNED,
    scheduleVersion: 2,
    epochId: EPOCH_ID,
    originalScheduledAt: new Date("2026-06-11T09:00:00.000Z"),
    effectiveScheduledAt: new Date("2026-06-11T09:00:00.000Z"),
    timezone: "Europe/Berlin",
    sourceWorkspaceId: WORKSPACE_ID,
    sourceType: CalendarSourceType.WORKSPACE,
    sourceProjectId: null,
    sourceAccuracy: CalendarSourceAccuracy.EXACT,
    timeAccuracy: CalendarTimeAccuracy.EXACT,
    releasedTask: null,
    ...overrides,
  };
}

async function readBody(response: Response) {
  return (await response.json()) as {
    data: {
      scheduleRevision: number;
      occurrences: {
        id: string;
        state: string;
        isMissed: boolean;
        effectiveScheduledAt: string;
        sourceId: string;
        releasedTask: { id: string; name: string; status: string } | null;
      }[];
    };
    meta: {
      pagination: {
        cursor: string | null;
        limit: number;
        total: number;
        nextCursor: string | null;
      };
    };
  };
}

describe("GET /tasks/{id}/schedule/occurrences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    memberFindFirstMock.mockResolvedValue({ id: "member_123" });
    requireTaskCollaborationMock.mockResolvedValue({
      id: TASK_ID,
      status: TaskStatus.READY,
      workspaceId: WORKSPACE_ID,
      projectId: null,
      scheduleRevision: 4,
    });
    occurrenceCountMock.mockResolvedValue(0);
    occurrenceFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects agent actors so only an interactive human reads the ledger", async () => {
    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    });

    const response = await app.request(request());

    expect(response.status).toBe(403);
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
    expect(occurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("requires Calendar beta access", async () => {
    memberFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(request());

    expect(response.status).toBe(403);
    expect(requireTaskCollaborationMock).not.toHaveBeenCalled();
    expect(occurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("requires Task collaboration and surfaces a missing Task as 404", async () => {
    const { notFound } = await import("@/helpers/error");
    requireTaskCollaborationMock.mockRejectedValue(notFound("Task not found"));

    const response = await createApp().request(request());

    expect(response.status).toBe(404);
    expect(occurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("returns an empty page with the current revision when the series was removed", async () => {
    const response = await createApp().request(request("?view=upcoming"));

    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data).toEqual({ scheduleRevision: 4, occurrences: [] });
    expect(body.meta.pagination).toEqual({
      cursor: null,
      limit: 20,
      total: 0,
      nextCursor: null,
    });
  });

  it("lists future planned and skipped occurrences ascending inside the horizon", async () => {
    occurrenceFindManyMock.mockResolvedValue([
      createRow(),
      createRow({
        id: "33333333-3333-7333-8333-333333333332",
        state: TaskScheduleOccurrenceState.SKIPPED,
        effectiveScheduledAt: new Date("2026-06-12T09:00:00.000Z"),
      }),
    ]);

    const response = await createApp().request(request("?view=upcoming"));

    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data.occurrences.map((occurrence) => occurrence.state)).toEqual(
      ["PLANNED", "SKIPPED"],
    );
    const [args] = occurrenceFindManyMock.mock.calls[0] as [
      {
        where: Record<string, unknown>;
        orderBy: unknown;
        take: number;
      },
    ];
    expect(args.orderBy).toEqual([
      { effectiveScheduledAt: "asc" },
      { id: "asc" },
    ]);
    expect(args.where).toMatchObject({
      seriesTaskId: TASK_ID,
      state: {
        in: [
          TaskScheduleOccurrenceState.PLANNED,
          TaskScheduleOccurrenceState.SKIPPED,
        ],
      },
      effectiveScheduledAt: {
        gte: NOW,
        // The upcoming view stays inside the existing 90-day projection.
        lt: new Date("2026-09-08T00:00:00.000Z"),
      },
    });
  });

  it("lists released, canceled, and past occurrences descending in history", async () => {
    occurrenceFindManyMock.mockResolvedValue([
      createRow({
        id: "33333333-3333-7333-8333-333333333333",
        state: TaskScheduleOccurrenceState.RELEASED,
        effectiveScheduledAt: new Date("2026-06-09T09:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-09T09:00:00.000Z"),
        sourceType: CalendarSourceType.PROJECT,
        sourceProjectId: PROJECT_ID,
        releasedTask: {
          id: "tsk_released",
          name: "Prepare release notes",
          status: TaskStatus.COMPLETED,
        },
      }),
      createRow({
        id: "33333333-3333-7333-8333-333333333334",
        state: TaskScheduleOccurrenceState.PLANNED,
        effectiveScheduledAt: new Date("2026-06-08T09:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-08T09:00:00.000Z"),
      }),
    ]);

    const response = await createApp().request(request("?view=history"));

    expect(response.status).toBe(200);
    const body = await readBody(response);
    const [released, missed] = body.data.occurrences;
    expect(released).toMatchObject({
      state: "RELEASED",
      isMissed: false,
      sourceId: `project:${PROJECT_ID}`,
      releasedTask: {
        id: "tsk_released",
        name: "Prepare release notes",
        status: "COMPLETED",
      },
    });
    // A past PLANNED row never released, so history shows it as missed.
    expect(missed).toMatchObject({
      state: "PLANNED",
      isMissed: true,
      releasedTask: null,
    });

    const [args] = occurrenceFindManyMock.mock.calls[0] as [
      { where: Record<string, unknown>; orderBy: unknown },
    ];
    expect(args.orderBy).toEqual([
      { effectiveScheduledAt: "desc" },
      { id: "desc" },
    ]);
    expect(args.where).toMatchObject({
      seriesTaskId: TASK_ID,
      OR: [
        {
          state: {
            in: [
              TaskScheduleOccurrenceState.RELEASED,
              TaskScheduleOccurrenceState.CANCELED,
            ],
          },
        },
        {
          state: {
            in: [
              TaskScheduleOccurrenceState.PLANNED,
              TaskScheduleOccurrenceState.SKIPPED,
            ],
          },
          effectiveScheduledAt: { lt: NOW },
        },
      ],
    });
  });

  it("caps the page at the requested limit and offers a keyset cursor", async () => {
    occurrenceCountMock.mockResolvedValue(9);
    occurrenceFindManyMock.mockResolvedValue([
      createRow(),
      createRow({
        id: "33333333-3333-7333-8333-333333333332",
        effectiveScheduledAt: new Date("2026-06-12T09:00:00.000Z"),
      }),
      createRow({
        id: "33333333-3333-7333-8333-333333333333",
        effectiveScheduledAt: new Date("2026-06-13T09:00:00.000Z"),
      }),
    ]);

    const response = await createApp().request(request("?limit=2"));

    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data.occurrences).toHaveLength(2);
    expect(body.meta.pagination).toMatchObject({
      cursor: null,
      limit: 2,
      total: 9,
    });
    const [args] = occurrenceFindManyMock.mock.calls[0] as [{ take: number }];
    expect(args.take).toBe(3);

    expect(body.meta.pagination.nextCursor).toBe(
      encodeTaskScheduleOccurrenceCursor({
        view: "upcoming",
        scheduleRevision: 4,
        effectiveScheduledAt: "2026-06-12T09:00:00.000Z",
        id: "33333333-3333-7333-8333-333333333332",
      }),
    );
  });

  it("returns no cursor on the final page", async () => {
    occurrenceFindManyMock.mockResolvedValue([createRow()]);

    const response = await createApp().request(request("?limit=2"));

    const body = await readBody(response);
    expect(body.data.occurrences).toHaveLength(1);
    expect(body.meta.pagination.nextCursor).toBeNull();
  });

  it("continues an upcoming page after the cursor key", async () => {
    const cursor = encodeTaskScheduleOccurrenceCursor({
      view: "upcoming",
      scheduleRevision: 4,
      effectiveScheduledAt: "2026-06-11T09:00:00.000Z",
      id: "33333333-3333-7333-8333-333333333331",
    });

    const response = await createApp().request(
      request(`?view=upcoming&cursor=${encodeURIComponent(cursor)}`),
    );

    expect(response.status).toBe(200);
    expect((await readBody(response)).meta.pagination.cursor).toBe(cursor);
    const [args] = occurrenceFindManyMock.mock.calls[0] as [
      { where: { AND?: unknown } },
    ];
    expect(args.where.AND).toEqual([
      {
        OR: [
          {
            effectiveScheduledAt: {
              gt: new Date("2026-06-11T09:00:00.000Z"),
            },
          },
          {
            effectiveScheduledAt: new Date("2026-06-11T09:00:00.000Z"),
            id: { gt: "33333333-3333-7333-8333-333333333331" },
          },
        ],
      },
    ]);
  });

  it("continues a history page before the cursor key", async () => {
    const cursor = encodeTaskScheduleOccurrenceCursor({
      view: "history",
      scheduleRevision: 4,
      effectiveScheduledAt: "2026-06-09T09:00:00.000Z",
      id: "33333333-3333-7333-8333-333333333333",
    });

    const response = await createApp().request(
      request(`?view=history&cursor=${encodeURIComponent(cursor)}`),
    );

    expect(response.status).toBe(200);
    const [args] = occurrenceFindManyMock.mock.calls[0] as [
      { where: { AND?: unknown } },
    ];
    expect(args.where.AND).toEqual([
      {
        OR: [
          {
            effectiveScheduledAt: {
              lt: new Date("2026-06-09T09:00:00.000Z"),
            },
          },
          {
            effectiveScheduledAt: new Date("2026-06-09T09:00:00.000Z"),
            id: { lt: "33333333-3333-7333-8333-333333333333" },
          },
        ],
      },
    ]);
  });

  it("rejects a cursor minted before the series revision changed", async () => {
    const cursor = encodeTaskScheduleOccurrenceCursor({
      view: "upcoming",
      scheduleRevision: 3,
      effectiveScheduledAt: "2026-06-11T09:00:00.000Z",
      id: "33333333-3333-7333-8333-333333333331",
    });

    const response = await createApp().request(
      request(`?view=upcoming&cursor=${encodeURIComponent(cursor)}`),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_cursor_stale",
    });
    expect(occurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects a cursor minted for the other view", async () => {
    const cursor = encodeTaskScheduleOccurrenceCursor({
      view: "history",
      scheduleRevision: 4,
      effectiveScheduledAt: "2026-06-09T09:00:00.000Z",
      id: "33333333-3333-7333-8333-333333333333",
    });

    const response = await createApp().request(
      request(`?view=upcoming&cursor=${encodeURIComponent(cursor)}`),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      kind: "schedule_cursor_stale",
    });
    expect(occurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed cursor as a bad request", async () => {
    const response = await createApp().request(request("?cursor=not-a-cursor"));

    expect(response.status).toBe(400);
    expect(occurrenceFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects a limit above the shared maximum", async () => {
    const response = await createApp().request(request("?limit=101"));

    expect(response.status).toBe(422);
    expect(occurrenceFindManyMock).not.toHaveBeenCalled();
  });
});
