import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import { notificationFeedWhere } from "@/helpers/notification-feed";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountGetNotifications from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  notificationCountMock,
  notificationFindFirstMock,
  notificationFindManyMock,
  prismaTransactionMock,
  vendorGrantFindManyMock,
  coworkerWorkspaceAccessFindManyMock,
  taskFindManyMock,
  jobFindManyMock,
} = vi.hoisted(() => ({
  notificationCountMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  vendorGrantFindManyMock: vi.fn(),
  coworkerWorkspaceAccessFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  jobFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    notification: {
      count: notificationCountMock,
      findFirst: notificationFindFirstMock,
      findMany: notificationFindManyMock,
    },
    vendorGrant: {
      findMany: vendorGrantFindManyMock,
    },
    coworkerWorkspaceAccess: {
      findMany: coworkerWorkspaceAccessFindManyMock,
    },
    task: {
      findMany: taskFindManyMock,
    },
    job: {
      findMany: jobFindManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mountGetNotifications(app);
  return app;
}

function createNotificationRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "notif_123",
    userId: "user_123",
    kind: NotificationKind.JOB,
    referenceId: "job_123",
    eventId: "event_123",
    messageKey: "Notifications.Job.completed",
    messageParams: JSON.stringify({
      agentName: "Research Agent",
      jobName: "Market Analysis",
    }),
    metadata: JSON.stringify({ agentId: "agent_123" }),
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-06-16T15:00:00.000Z"),
    ...overrides,
  };
}

describe("GET /notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationFindFirstMock.mockResolvedValue(null);
    // Default: stale access-request lookups find no pending notifications.
    notificationFindManyMock.mockResolvedValue([]);
    notificationCountMock.mockResolvedValue(0);
    vendorGrantFindManyMock.mockResolvedValue([]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    jobFindManyMock.mockResolvedValue([]);
    prismaTransactionMock.mockImplementation(
      async (operations: Array<Promise<unknown>>) =>
        await Promise.all(operations),
    );
  });

  it("lists notifications scoped to the authenticated user", async () => {
    const row = createNotificationRow();
    // findMany: vendor stale, coworker stale (Promise.all), then page.
    notificationFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row]);
    notificationCountMock.mockResolvedValue(1);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenLastCalledWith({
      where: {
        userId: "user_123",
        ...notificationFeedWhere(),
      },
      take: LIMITS.DEFAULT_PAGINATION_LIMIT + 1,
      skip: undefined,
      cursor: undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        ...notificationFeedWhere(),
      },
    });

    const body = (await response.json()) as {
      data: Array<{ id: string; messageKey: string }>;
      meta: { pagination: { nextCursor: string | null; total: number } };
    };
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "notif_123",
        messageKey: "Notifications.Job.completed",
      }),
    ]);
    expect(body.meta.pagination.total).toBe(1);
    expect(body.meta.pagination.nextCursor).toBeNull();
  });

  it("applies kind and isRead filters", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?kind=JOB,TASK&isRead=false",
    );

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          ...notificationFeedWhere([
            NotificationKind.JOB,
            NotificationKind.TASK,
          ]),
          isRead: false,
        },
      }),
    );
  });

  /**
   * CHAT asked for by name is not thrown away any more. It narrows to the chat
   * rows the feed has, which the clause itself decides, so the route hands the
   * kind through and the exclusion stays in one place.
   */
  it("hands an explicit CHAT filter to the feed clause", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?kind=JOB,CHAT&isRead=false",
    );

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          ...notificationFeedWhere([
            NotificationKind.JOB,
            NotificationKind.CHAT,
          ]),
          isRead: false,
        },
      }),
    );
  });

  it("validates cursors against the same user and filter scope", async () => {
    notificationFindFirstMock.mockResolvedValue({ id: "notif_cursor" });

    const app = createApp();
    const response = await app.request(
      "http://localhost/?cursor=notif_cursor&kind=JOB&isRead=false&limit=10",
    );

    expect(response.status).toBe(200);
    expect(notificationFindFirstMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            userId: "user_123",
            ...notificationFeedWhere([NotificationKind.JOB]),
            isRead: false,
          },
          { id: "notif_cursor" },
        ],
      },
      select: { id: true },
    });
    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "notif_cursor" },
        skip: 1,
        take: 11,
      }),
    );
  });

  it("returns 400 when the cursor is outside the scoped query", async () => {
    notificationFindFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(
      "http://localhost/?cursor=notif_missing&kind=JOB",
    );

    expect(response.status).toBe(400);
    // Only stale access-request lookups run; the page query does not.
    expect(notificationFindManyMock).toHaveBeenCalledTimes(2);
    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        messageKey: "notifications.vendorGrant.pending",
      },
      select: { referenceId: true },
    });
    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        messageKey: "notifications.coworkerAccess.pending",
      },
      select: { referenceId: true },
    });
  });

  it("excludes resolved vendor-grant notifications from the feed where clause", async () => {
    // Promise.all order: vendor stale lookup, coworker stale lookup, then page.
    notificationFindManyMock
      .mockResolvedValueOnce([
        { referenceId: "grant_resolved" },
        { referenceId: "grant_pending" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vendorGrantFindManyMock.mockResolvedValue([
      { id: "grant_pending", status: "PENDING" },
      { id: "grant_resolved", status: "GRANTED" },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          ...notificationFeedWhere(),
          NOT: {
            AND: [
              { messageKey: "notifications.vendorGrant.pending" },
              { referenceId: { in: ["grant_resolved"] } },
            ],
          },
        },
      }),
    );
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        ...notificationFeedWhere(),
        NOT: {
          AND: [
            { messageKey: "notifications.vendorGrant.pending" },
            { referenceId: { in: ["grant_resolved"] } },
          ],
        },
      },
    });
  });

  it("excludes resolved coworker-access notifications from the feed where clause", async () => {
    notificationFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { referenceId: "access_resolved" },
        { referenceId: "access_pending" },
      ])
      .mockResolvedValueOnce([]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([
      { id: "access_pending", status: "PENDING" },
      { id: "access_resolved", status: "GRANTED" },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          ...notificationFeedWhere(),
          NOT: {
            AND: [
              { messageKey: "notifications.coworkerAccess.pending" },
              { referenceId: { in: ["access_resolved"] } },
            ],
          },
        },
      }),
    );
  });
});

/**
 * A minimal job row for the status helper: a free job whose latest event
 * decides everything. Waiting means the agent asked for input and none came.
 */
function jobRow(id: string, waiting: boolean): Record<string, unknown> {
  return {
    id,
    projectId: null,
    jobType: "FREE",
    refundedTransactionId: null,
    createdAt: new Date("2026-06-16T15:00:00.000Z"),
    payByTime: null,
    submitResultTime: null,
    externalDisputeUnlockTime: null,
    purchase: null,
    events: [
      waiting
        ? { status: "AWAITING_INPUT", input: null }
        : { status: "COMPLETED", input: null },
    ],
  };
}

/**
 * The rows that asked something of the reader, by key and record. Answered
 * by the notification findMany mock when the route asks for the actionable
 * keys, so the stale access lookups (one key each) keep their own answers.
 */
function answerNotificationLookups(
  actionable: Array<{ id: string; messageKey: string; referenceId: string }>,
) {
  notificationFindManyMock.mockImplementation(
    async ({ where }: { where: { messageKey?: unknown } }) => {
      const key = where.messageKey;
      if (typeof key === "object" && key !== null && "in" in key) {
        return actionable;
      }
      return [];
    },
  );
}

describe("GET /notifications?needsAction=true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationFindFirstMock.mockResolvedValue(null);
    notificationFindManyMock.mockResolvedValue([]);
    notificationCountMock.mockResolvedValue(0);
    vendorGrantFindManyMock.mockResolvedValue([]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    jobFindManyMock.mockResolvedValue([]);
    prismaTransactionMock.mockImplementation(
      async (operations: Array<Promise<unknown>>) =>
        await Promise.all(operations),
    );
  });

  /**
   * SOK-1097 user stories 5 to 8 and 12 to 15. The key says a row asked; the
   * record says whether it is still asking. Reading the row changes neither.
   */
  it("narrows the feed to the newest row of each request still waiting", async () => {
    answerNotificationLookups([
      // Newest first, as the lookup orders them.
      {
        id: "n_task_asked_again",
        messageKey: "Notifications.Task.inputRequired",
        referenceId: "task_waiting",
      },
      {
        id: "n_task_asked_first",
        messageKey: "Notifications.Task.inputRequired",
        referenceId: "task_waiting",
      },
      {
        id: "n_task_moved_on",
        messageKey: "Notifications.Task.inputRequired",
        referenceId: "task_resumed",
      },
      {
        id: "n_job_waiting",
        messageKey: "Notifications.Job.inputRequired",
        referenceId: "job_waiting",
      },
      {
        id: "n_job_done",
        messageKey: "Notifications.Job.inputRequired",
        referenceId: "job_done",
      },
      {
        id: "n_grant_pending",
        messageKey: "notifications.vendorGrant.pending",
        referenceId: "grant_pending",
      },
      {
        id: "n_access_denied",
        messageKey: "notifications.coworkerAccess.pending",
        referenceId: "access_denied",
      },
    ]);
    taskFindManyMock.mockResolvedValue([{ id: "task_waiting" }]);
    jobFindManyMock.mockResolvedValue([
      jobRow("job_waiting", true),
      jobRow("job_done", false),
    ]);
    vendorGrantFindManyMock.mockResolvedValue([{ id: "grant_pending" }]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([]);

    const app = createApp();
    const response = await app.request("http://localhost/?needsAction=true");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ["task_waiting", "task_resumed"] },
        status: "INPUT_REQUIRED",
      },
      select: { id: true },
    });
    expect(vendorGrantFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["grant_pending"] }, status: "PENDING" },
      select: { id: true },
    });
    expect(coworkerWorkspaceAccessFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["access_denied"] }, status: "PENDING" },
      select: { id: true },
    });
    const expectedWhere = {
      userId: "user_123",
      ...notificationFeedWhere(),
      id: { in: ["n_task_asked_again", "n_job_waiting", "n_grant_pending"] },
    };
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: expectedWhere,
    });
  });

  it("asks no record anything when nothing ever asked the reader", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?needsAction=true");

    expect(response.status).toBe(200);
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(jobFindManyMock).not.toHaveBeenCalled();
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          ...notificationFeedWhere(),
          id: { in: [] },
        },
      }),
    );
  });

  it("narrows on top of the kind filter", async () => {
    answerNotificationLookups([
      {
        id: "n_task",
        messageKey: "Notifications.Task.inputRequired",
        referenceId: "task_waiting",
      },
    ]);
    taskFindManyMock.mockResolvedValue([{ id: "task_waiting" }]);

    const app = createApp();
    const response = await app.request(
      "http://localhost/?needsAction=true&kind=TASK",
    );

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          ...notificationFeedWhere([NotificationKind.TASK]),
          id: { in: ["n_task"] },
        },
      }),
    );
  });

  it("pages older rows inside the narrowed feed", async () => {
    answerNotificationLookups([
      {
        id: "n_task",
        messageKey: "Notifications.Task.inputRequired",
        referenceId: "task_waiting",
      },
    ]);
    taskFindManyMock.mockResolvedValue([{ id: "task_waiting" }]);
    notificationFindFirstMock.mockResolvedValue({ id: "n_task" });

    const app = createApp();
    const response = await app.request(
      "http://localhost/?needsAction=true&cursor=n_task",
    );

    expect(response.status).toBe(200);
    // The cursor must be a row of this view, not just a row of the feed.
    expect(notificationFindFirstMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            userId: "user_123",
            ...notificationFeedWhere(),
            id: { in: ["n_task"] },
          },
          { id: "n_task" },
        ],
      },
      select: { id: true },
    });
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: "n_task" }, skip: 1 }),
    );
  });

  it("leaves the feed whole when the flag is false", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?needsAction=false");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: "user_123", ...notificationFeedWhere() },
      }),
    );
  });
});

describe("GET /notifications?mentions=true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationFindFirstMock.mockResolvedValue(null);
    notificationFindManyMock.mockResolvedValue([]);
    notificationCountMock.mockResolvedValue(0);
    vendorGrantFindManyMock.mockResolvedValue([]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([]);
    prismaTransactionMock.mockImplementation(
      async (operations: Array<Promise<unknown>>) =>
        await Promise.all(operations),
    );
  });

  it("narrows the feed to the rows where someone named the reader", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?mentions=true");

    expect(response.status).toBe(200);
    const where = {
      userId: "user_123",
      ...notificationFeedWhere(),
      messageKey: {
        in: [
          "Notifications.Chat.mentioned",
          "Notifications.Chat.mentionedFollowUp",
        ],
      },
    };
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ where }),
    );
    expect(notificationCountMock).toHaveBeenCalledWith({ where });
  });

  it("leaves the feed whole when the flag is false", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?mentions=false");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: "user_123", ...notificationFeedWhere() },
      }),
    );
  });
});
