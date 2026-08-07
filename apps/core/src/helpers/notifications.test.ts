import { type Notification, NotificationKind } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import type prisma from "@/lib/db/prisma";

import { VENDOR_GRANT_PENDING_MESSAGE_KEY } from "./notification-feed";
import {
  type CreateNotificationInput,
  createNotification,
  deletePendingVendorGrantNotifications,
} from "./notifications";

const { publishNotificationEventMock } = vi.hoisted(() => ({
  publishNotificationEventMock: vi.fn(),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishNotificationEvent: publishNotificationEventMock,
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

const CREATED_AT = new Date("2026-06-18T09:00:00.000Z");
const READ_AT = new Date("2026-06-18T09:30:00.000Z");
const JOB_KIND = NotificationKind.JOB;

const notificationInput: CreateNotificationInput = {
  userId: "user_123",
  kind: JOB_KIND,
  referenceId: "job_123",
  eventId: "job_event_123",
  messageKey: "Notifications.Job.completed",
  messageParams: {
    agentName: "Research Agent",
    jobName: "Market Analysis",
  },
  metadata: {
    agentId: "agent_123",
    projectId: "project_123",
  },
};

function createNotificationRecord(
  overrides: Partial<Notification> = {},
): Notification {
  return {
    id: "notification_123",
    userId: notificationInput.userId,
    kind: notificationInput.kind,
    referenceId: notificationInput.referenceId,
    eventId: notificationInput.eventId,
    messageKey: notificationInput.messageKey,
    messageParams: JSON.stringify(notificationInput.messageParams),
    metadata: JSON.stringify(notificationInput.metadata),
    isRead: false,
    readAt: null,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function createPrismaMock() {
  return {
    notification: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

function createUniqueViolation() {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
  });
}

describe("createNotification", () => {
  it("creates a notification and serializes structured fields", async () => {
    publishNotificationEventMock.mockResolvedValue(undefined);
    const notification = createNotificationRecord();
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(notification);

    const result = await createNotification(
      notificationInput,
      prismaMock as unknown as typeof prisma,
    );

    expect(result).toEqual({ notification, created: true });
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: {
        userId: notificationInput.userId,
        kind: notificationInput.kind,
        referenceId: notificationInput.referenceId,
        eventId: notificationInput.eventId,
        messageKey: notificationInput.messageKey,
        messageParams: JSON.stringify(notificationInput.messageParams),
        metadata: JSON.stringify(notificationInput.metadata),
      },
    });
    expect(publishNotificationEventMock).toHaveBeenCalledWith({
      userId: notification.userId,
      notification: {
        id: notification.id,
        userId: notification.userId,
        kind: notification.kind,
        referenceId: notification.referenceId,
        eventId: notification.eventId,
        messageKey: notification.messageKey,
        messageParams: notificationInput.messageParams,
        metadata: notificationInput.metadata,
        isRead: notification.isRead,
        readAt: null,
        createdAt: notification.createdAt.toISOString(),
      },
    });
    expect(prismaMock.notification.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.notification.upsert).not.toHaveBeenCalled();
  });

  it("returns the existing row unchanged on duplicate emits", async () => {
    publishNotificationEventMock.mockClear();
    const existing = createNotificationRecord({
      messageParams: JSON.stringify({ jobName: "Original job name" }),
      metadata: JSON.stringify({ agentId: "original_agent" }),
      createdAt: new Date("2026-06-18T08:00:00.000Z"),
    });
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockRejectedValue(createUniqueViolation());
    prismaMock.notification.findUnique.mockResolvedValue(existing);

    const result = await createNotification(
      {
        ...notificationInput,
        messageParams: { jobName: "Changed job name" },
        metadata: { agentId: "changed_agent" },
      },
      prismaMock as unknown as typeof prisma,
    );

    expect(result).toEqual({ notification: existing, created: false });
    expect(publishNotificationEventMock).not.toHaveBeenCalled();
    expect(prismaMock.notification.findUnique).toHaveBeenCalledWith({
      where: {
        userId_kind_referenceId_eventId_messageKey: {
          userId: notificationInput.userId,
          kind: notificationInput.kind,
          referenceId: notificationInput.referenceId,
          eventId: notificationInput.eventId,
          messageKey: notificationInput.messageKey,
        },
      },
    });
    expect(prismaMock.notification.update).not.toHaveBeenCalled();
    expect(prismaMock.notification.upsert).not.toHaveBeenCalled();
  });

  it("creates a separate row when the message key differs for the same event", async () => {
    publishNotificationEventMock.mockClear();
    const existing = createNotificationRecord({
      messageKey: "Notifications.Job.completed",
    });
    const created = createNotificationRecord({
      id: "notification_456",
      messageKey: "Notifications.Job.paymentFailed",
    });
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(created);

    const result = await createNotification(
      {
        ...notificationInput,
        messageKey: "Notifications.Job.paymentFailed",
      },
      prismaMock as unknown as typeof prisma,
    );

    expect(result).toEqual({ notification: created, created: true });
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: {
        userId: notificationInput.userId,
        kind: notificationInput.kind,
        referenceId: notificationInput.referenceId,
        eventId: notificationInput.eventId,
        messageKey: "Notifications.Job.paymentFailed",
        messageParams: JSON.stringify(notificationInput.messageParams),
        metadata: JSON.stringify(notificationInput.metadata),
      },
    });
    expect(publishNotificationEventMock).toHaveBeenCalled();
    expect(prismaMock.notification.findUnique).not.toHaveBeenCalled();
    expect(existing.messageKey).toBe("Notifications.Job.completed");
  });

  it("preserves read state when a duplicate emit arrives after mark-read", async () => {
    publishNotificationEventMock.mockClear();
    const existing = createNotificationRecord({
      isRead: true,
      readAt: READ_AT,
    });
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockRejectedValue(createUniqueViolation());
    prismaMock.notification.findUnique.mockResolvedValue(existing);

    const result = await createNotification(
      notificationInput,
      prismaMock as unknown as typeof prisma,
    );

    expect(result.notification.isRead).toBe(true);
    expect(result.notification.readAt).toBe(READ_AT);
    expect(result.created).toBe(false);
    expect(publishNotificationEventMock).not.toHaveBeenCalled();
    expect(prismaMock.notification.update).not.toHaveBeenCalled();
    expect(prismaMock.notification.upsert).not.toHaveBeenCalled();
  });
});

describe("deletePendingVendorGrantNotifications", () => {
  it("deletes SYSTEM pending vendor-grant notifications for the grant id", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 2 });

    await expect(
      deletePendingVendorGrantNotifications(
        "grant_123",
        prismaMock as unknown as typeof prisma,
      ),
    ).resolves.toBe(2);

    expect(prismaMock.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        referenceId: "grant_123",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        kind: NotificationKind.SYSTEM,
      },
    });
  });

  it("returns zero when no matching notifications exist", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      deletePendingVendorGrantNotifications(
        "grant_missing",
        prismaMock as unknown as typeof prisma,
      ),
    ).resolves.toBe(0);
  });
});
