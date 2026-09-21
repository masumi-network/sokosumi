import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeRawMock,
  findWorkspaceMock,
  queryRawMock,
  notificationFindUniqueMock,
  notificationUpdateManyMock,
  publishMock,
  transactionMock,
  txMock,
  userFindUniqueMock,
} = vi.hoisted(() => {
  const executeRawMock = vi.fn();
  const findWorkspaceMock = vi.fn();
  const queryRawMock = vi.fn();
  return {
    executeRawMock,
    findWorkspaceMock,
    queryRawMock,
    notificationFindUniqueMock: vi.fn(),
    notificationUpdateManyMock: vi.fn(),
    publishMock: vi.fn(),
    transactionMock: vi.fn(),
    txMock: {
      $executeRaw: executeRawMock,
      $queryRaw: queryRawMock,
      workspace: { findFirst: findWorkspaceMock },
    },
    userFindUniqueMock: vi.fn(),
  };
});

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

const notification = {
  id: "notification_1",
  userId: "user_1",
  workspaceId: WORKSPACE_ID,
  organizationId: "organization_1",
  kind: NotificationKind.TASK,
  referenceId: "task_1",
  eventId: "event_1",
  messageKey: "Notifications.Task.scheduleUpdatedByMember",
  messageParams: JSON.stringify({ taskName: "Plan" }),
  metadata: JSON.stringify({ workspaceId: WORKSPACE_ID }),
  isRead: false,
  readAt: null,
  createdAt: new Date("2026-09-14T10:00:00.000Z"),
  inApp: true,
  emailId: null,
  emailScheduledAt: null,
  publishId: "revision_1",
  publishPush: false,
  publishCreated: true,
  publishQueuedAt: new Date("2026-09-14T10:00:00.000Z"),
  publishNextAttemptAt: new Date("2026-09-14T10:00:00.000Z"),
};

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    notification: {
      findUnique: notificationFindUniqueMock,
      updateMany: notificationUpdateManyMock,
    },
    user: { findUnique: userFindUniqueMock },
  },
}));

vi.mock("@/lib/ably/publish", () => ({
  publishNotificationEvent: (...args: unknown[]) => publishMock(...args),
}));

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import { dispatchNotificationPublish } from "./notification-publish";

const NOW = new Date("2026-09-14T10:00:30.000Z");

describe("scoped notification publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: typeof txMock) => unknown) => callback(txMock),
    );
    userFindUniqueMock.mockResolvedValue({
      pushOptIn: false,
      notificationPreferences: [],
    });
    notificationFindUniqueMock.mockResolvedValue(notification);
    notificationUpdateManyMock.mockResolvedValue({ count: 1 });
    findWorkspaceMock.mockResolvedValue({ id: WORKSPACE_ID });
    executeRawMock.mockResolvedValue(0);
    queryRawMock.mockResolvedValue([]);
    publishMock.mockResolvedValue(undefined);
  });

  it("rechecks access under the membership lock before publishing", async () => {
    expect(await dispatchNotificationPublish(notification.id, NOW)).toBe(
      "published",
    );

    expect(executeRawMock).toHaveBeenCalledOnce();
    expect(findWorkspaceMock).toHaveBeenCalledWith({
      where: {
        id: WORKSPACE_ID,
        OR: [
          { userId: notification.userId },
          {
            organization: {
              members: { some: { userId: notification.userId } },
            },
          },
        ],
      },
      select: { id: true },
    });
    expect(publishMock).toHaveBeenCalledOnce();
  });

  it("does not publish a row after Workspace access is gone", async () => {
    findWorkspaceMock.mockResolvedValue(null);

    expect(await dispatchNotificationPublish(notification.id, NOW)).toBe(
      "skipped",
    );

    expect(executeRawMock).toHaveBeenCalledOnce();
    expect(publishMock).not.toHaveBeenCalled();
  });
});
