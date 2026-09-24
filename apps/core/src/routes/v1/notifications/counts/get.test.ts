import { beforeEach, describe, expect, it, vi } from "vitest";

import { notificationFeedWhere } from "@/helpers/notification-feed";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountGetCounts from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  notificationCountMock,
  notificationFindManyMock,
  vendorGrantFindManyMock,
  coworkerWorkspaceAccessFindManyMock,
  taskFindManyMock,
  jobFindManyMock,
} = vi.hoisted(() => ({
  notificationCountMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  vendorGrantFindManyMock: vi.fn(),
  coworkerWorkspaceAccessFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  jobFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    notification: {
      count: notificationCountMock,
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

  mountGetCounts(app);
  return app;
}

/**
 * Answers the notification lookups by what they ask for: the actionable keys
 * get the rows that asked the reader something, and the single-key stale
 * access lookups get nothing. Counts answer by whether the where narrows to
 * ids or to message keys, so unread, needs-action and mentions can be told
 * apart.
 */
function answerLookups(
  actionable: Array<{ id: string; messageKey: string; referenceId: string }>,
  counts: { unread: number; needsAction: number; mentions: number },
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
  notificationCountMock.mockImplementation(
    async ({ where }: { where: { id?: unknown; messageKey?: unknown } }) => {
      if (where.messageKey !== undefined) return counts.mentions;
      return where.id === undefined ? counts.unread : counts.needsAction;
    },
  );
}

describe("GET /notifications/counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationCountMock.mockResolvedValue(0);
    notificationFindManyMock.mockResolvedValue([]);
    vendorGrantFindManyMock.mockResolvedValue([]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    jobFindManyMock.mockResolvedValue([]);
  });

  /**
   * SOK-1097 user stories 3, 25 and 33. One request for the bell and both
   * tabs, and the needs-action number counts the same rows the list shows.
   */
  it("returns the unread, needs-action and mentions counts for the reader", async () => {
    answerLookups(
      [
        {
          id: "n_task",
          messageKey: "Notifications.Task.inputRequired",
          referenceId: "task_waiting",
        },
        {
          id: "n_task_done",
          messageKey: "Notifications.Task.inputRequired",
          referenceId: "task_done",
        },
      ],
      { unread: 5, needsAction: 1, mentions: 2 },
    );
    taskFindManyMock.mockResolvedValue([{ id: "task_waiting" }]);

    const app = createApp();
    const response = await app.request("http://localhost/counts");

    expect(response.status).toBe(200);
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        ...notificationFeedWhere(),
      },
    });
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        ...notificationFeedWhere(),
        id: { in: ["n_task"] },
      },
    });
    // The Mentions tab counts what is still unread under it.
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        ...notificationFeedWhere(),
        isRead: false,
        messageKey: {
          in: [
            "Notifications.Chat.mentioned",
            "Notifications.Chat.mentionedFollowUp",
          ],
        },
      },
    });

    const body = (await response.json()) as {
      data: { unread: number; needsAction: number; mentions: number };
    };
    expect(body.data).toEqual({ unread: 5, needsAction: 1, mentions: 2 });
  });

  it("excludes resolved vendor-grant notifications from both counts", async () => {
    // Promise.all: vendor stale lookup first, coworker stale second, then
    // the actionable keys.
    notificationFindManyMock
      .mockResolvedValueOnce([{ referenceId: "grant_resolved" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vendorGrantFindManyMock.mockResolvedValue([
      { id: "grant_resolved", status: "GRANTED" },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/counts");

    expect(response.status).toBe(200);
    const exclusion = {
      NOT: {
        AND: [
          { messageKey: "notifications.vendorGrant.pending" },
          { referenceId: { in: ["grant_resolved"] } },
        ],
      },
    };
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        ...notificationFeedWhere(),
        ...exclusion,
      },
    });
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        ...notificationFeedWhere(),
        ...exclusion,
        id: { in: [] },
      },
    });
  });

  it("excludes resolved coworker-access notifications from both counts", async () => {
    notificationFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ referenceId: "access_resolved" }])
      .mockResolvedValueOnce([]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([
      { id: "access_resolved", status: "GRANTED" },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/counts");

    expect(response.status).toBe(200);
    const exclusion = {
      NOT: {
        AND: [
          { messageKey: "notifications.coworkerAccess.pending" },
          { referenceId: { in: ["access_resolved"] } },
        ],
      },
    };
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        ...notificationFeedWhere(),
        ...exclusion,
      },
    });
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        ...notificationFeedWhere(),
        ...exclusion,
        id: { in: [] },
      },
    });
  });
});
