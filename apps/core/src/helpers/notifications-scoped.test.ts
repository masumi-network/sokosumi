import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createMock,
  executeRawMock,
  queryRawMock,
  findNotificationMock,
  findWorkspaceMock,
  publishMock,
  transactionMock,
  txMock,
  userFindUniqueMock,
} = vi.hoisted(() => {
  const executeRawMock = vi.fn();
  const findNotificationMock = vi.fn();
  const findWorkspaceMock = vi.fn();
  const queryRawMock = vi.fn();
  return {
    createMock: vi.fn(),
    executeRawMock,
    queryRawMock,
    findNotificationMock,
    findWorkspaceMock,
    publishMock: vi.fn(),
    transactionMock: vi.fn(),
    txMock: {
      $executeRaw: executeRawMock,
      $queryRaw: queryRawMock,
      notification: { findUnique: findNotificationMock },
      workspace: { findFirst: findWorkspaceMock },
    },
    userFindUniqueMock: vi.fn(),
  };
});

const notification = {
  id: "notification_1",
  userId: "user_1",
  workspaceId: "11111111-1111-7111-8111-111111111111",
  organizationId: "organization_1",
  kind: NotificationKind.TASK,
  referenceId: "task_1",
  eventId: "event_1",
  messageKey: "Notifications.Task.scheduleUpdatedByMember",
  messageParams: JSON.stringify({ taskName: "Plan" }),
  metadata: JSON.stringify({
    workspaceId: "11111111-1111-7111-8111-111111111111",
  }),
  isRead: false,
  readAt: null,
  createdAt: new Date("2026-09-14T10:00:00.000Z"),
  inApp: true,
};

vi.mock("@/lib/db/prisma", () => {
  return {
    default: {
      $transaction: (...args: unknown[]) => transactionMock(...args),
      notification: { create: createMock },
      user: { findUnique: userFindUniqueMock },
    },
  };
});

vi.mock("@/lib/ably/publish", () => ({
  publishNotificationEvent: (...args: unknown[]) => publishMock(...args),
}));

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import { createNotification } from "./notifications";

describe("scoped notification publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (callback) => callback(txMock));
    userFindUniqueMock.mockResolvedValue({
      pushOptIn: false,
      notificationPreferences: [],
    });
    createMock.mockResolvedValue(notification);
    findNotificationMock.mockResolvedValue(notification);
    findWorkspaceMock.mockResolvedValue({ id: notification.workspaceId });
    executeRawMock.mockResolvedValue(0);
    queryRawMock.mockResolvedValue([]);
    publishMock.mockResolvedValue(undefined);
  });

  it("rechecks access under the membership lock before publishing", async () => {
    await createNotification({
      userId: notification.userId,
      workspaceId: notification.workspaceId,
      kind: NotificationKind.TASK,
      referenceId: notification.referenceId,
      eventId: notification.eventId,
      messageKey: notification.messageKey,
      messageParams: { taskName: "Plan" },
      metadata: { workspaceId: notification.workspaceId },
    });

    expect(executeRawMock).toHaveBeenCalledOnce();
    expect(findWorkspaceMock).toHaveBeenCalledWith({
      where: {
        id: notification.workspaceId,
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
    findWorkspaceMock.mockResolvedValueOnce(null);

    await createNotification({
      userId: notification.userId,
      workspaceId: notification.workspaceId,
      kind: NotificationKind.TASK,
      referenceId: notification.referenceId,
      eventId: notification.eventId,
      messageKey: notification.messageKey,
      messageParams: { taskName: "Plan" },
    });

    expect(publishMock).not.toHaveBeenCalled();
  });
});
