import { type Notification, NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type prisma from "@/lib/db/prisma";

import {
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "./notification-feed";
import {
  type CreateNotificationInput,
  createNotification,
  deletePendingCoworkerAccessNotifications,
  deletePendingVendorGrantNotifications,
} from "./notifications";

const { publishNotificationEventMock, userFindUniqueMock } = vi.hoisted(() => ({
  publishNotificationEventMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishNotificationEvent: publishNotificationEventMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
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
    inApp: true,
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
        inApp: true,
      },
    });
    expect(publishNotificationEventMock).toHaveBeenCalledWith({
      push: false,
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
        inApp: true,
        osBanner: false,
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
        inApp: true,
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

describe("createNotification push gating", () => {
  beforeEach(() => {
    // mockReset, not mockClear: these cases arm rejections and differing
    // resolved values, so a leftover implementation would leak forward and
    // let a later case pass on the previous case's publish.
    userFindUniqueMock.mockReset();
    publishNotificationEventMock.mockReset();
    publishNotificationEventMock.mockResolvedValue(undefined);
  });

  /** The reader's account row, as the delivery read selects it. */
  function mockReader({
    pushOptIn = true,
    preferences = [],
  }: {
    pushOptIn?: boolean;
    preferences?: {
      category: string;
      channel: string;
      enabled: boolean;
    }[];
  } = {}) {
    userFindUniqueMock.mockResolvedValue({
      pushOptIn,
      notificationPreferences: preferences,
    });
  }

  const chatInput: CreateNotificationInput = {
    ...notificationInput,
    kind: NotificationKind.CHAT,
    referenceId: "room_123",
    eventId: "chat_message_123",
    messageKey: "Notifications.Chat.mentioned",
    messageParams: { senderName: "Alice", roomName: "General" },
    metadata: { roomId: "room_123" },
  };

  function createChatRecord(): Notification {
    return createNotificationRecord({
      kind: chatInput.kind,
      referenceId: chatInput.referenceId,
      eventId: chatInput.eventId,
      messageKey: chatInput.messageKey,
      messageParams: JSON.stringify(chatInput.messageParams),
      metadata: JSON.stringify(chatInput.metadata),
    });
  }

  it("pushes a chat notification when the user opted in", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(createChatRecord());
    mockReader({ pushOptIn: true });

    await createNotification(chatInput, prismaMock as unknown as typeof prisma);

    expect(publishNotificationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        push: true,
        notification: expect.objectContaining({ osBanner: true }),
      }),
    );
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: chatInput.userId },
      select: {
        pushOptIn: true,
        notificationPreferences: {
          select: { category: true, channel: true, enabled: true },
        },
      },
    });
  });

  it("does not push a chat notification when the user did not opt in", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(createChatRecord());
    mockReader({ pushOptIn: false });

    await createNotification(chatInput, prismaMock as unknown as typeof prisma);

    expect(publishNotificationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ push: false }),
    );
  });

  // Every kind pushes now, not chat alone, so the gate is the opt-in and
  // nothing else. Listed rather than derived from the enum: a kind added later
  // should fail this list and make someone decide whether it pushes.
  const NON_CHAT_KINDS = [
    NotificationKind.JOB,
    NotificationKind.TASK,
    NotificationKind.SYSTEM,
    NotificationKind.BILLING,
  ] as const;

  for (const kind of NON_CHAT_KINDS) {
    it(`pushes a ${kind} notification when the user opted in`, async () => {
      const prismaMock = createPrismaMock();
      prismaMock.notification.create.mockResolvedValue(
        createNotificationRecord({ kind }),
      );
      mockReader({ pushOptIn: true });

      await createNotification(
        { ...notificationInput, kind },
        prismaMock as unknown as typeof prisma,
      );

      expect(publishNotificationEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ push: true }),
      );
    });

    it(`does not push a ${kind} notification when the user did not opt in`, async () => {
      const prismaMock = createPrismaMock();
      prismaMock.notification.create.mockResolvedValue(
        createNotificationRecord({ kind }),
      );
      mockReader({ pushOptIn: false });

      await createNotification(
        { ...notificationInput, kind },
        prismaMock as unknown as typeof prisma,
      );

      expect(publishNotificationEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ push: false }),
      );
    });
  }

  it("does not push when the user row is missing", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(createChatRecord());
    userFindUniqueMock.mockResolvedValue(null);

    await createNotification(chatInput, prismaMock as unknown as typeof prisma);

    expect(publishNotificationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ push: false }),
    );
  });

  it("reads opt-in off the global client, never the caller's transaction client", async () => {
    // Shaped like a Prisma.TransactionClient handed in by a caller mid-transaction.
    // A read on this client that fails would abort the transaction and lose the
    // row we just created, so the opt-in read must not touch it at all.
    const txMock = {
      notification: {
        create: vi.fn().mockResolvedValue(createChatRecord()),
        findUnique: vi.fn(),
      },
    };
    mockReader({ pushOptIn: true });

    const result = await createNotification(
      chatInput,
      txMock as unknown as typeof prisma,
    );

    expect(result.created).toBe(true);
    expect(publishNotificationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ push: true }),
    );
    expect(userFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the notification row when the push-gated publish fails", async () => {
    publishNotificationEventMock.mockRejectedValue(new Error("ably down"));
    const notification = createChatRecord();
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(notification);
    mockReader({ pushOptIn: true });

    await expect(
      createNotification(chatInput, prismaMock as unknown as typeof prisma),
    ).resolves.toEqual({ notification, created: true });
  });

  it("stores the notification unseen when the reader silenced the category in the app", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(
      createNotificationRecord({ inApp: false }),
    );
    mockReader({
      preferences: [{ category: "JOB", channel: "IN_APP", enabled: false }],
    });

    await createNotification(
      notificationInput,
      prismaMock as unknown as typeof prisma,
    );

    // Still written, so a later duplicate emit stays a no-op and the row can
    // still be deleted by reference. Hidden, not dropped.
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ inApp: false }),
      }),
    );
    // The banner survives the in-app choice: they are separate columns.
    expect(publishNotificationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ push: true }),
    );
  });

  it("keeps a notification in the app when the reader silenced only its banner", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(
      createNotificationRecord(),
    );
    mockReader({
      preferences: [{ category: "JOB", channel: "OS_BANNER", enabled: false }],
    });

    await createNotification(
      notificationInput,
      prismaMock as unknown as typeof prisma,
    );

    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ inApp: true }),
      }),
    );
    // An open tab renders its own banner from this event, so the answer has to
    // ride the payload and not only the push extras.
    expect(publishNotificationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        push: false,
        notification: expect.objectContaining({ osBanner: false }),
      }),
    );
  });

  it("splits the two chat rows, so muting mentions leaves direct messages alone", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(createChatRecord());
    mockReader({
      preferences: [
        { category: "CHAT_MENTION", channel: "IN_APP", enabled: false },
        { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
      ],
    });

    await createNotification(
      {
        ...chatInput,
        messageKey: "Notifications.Chat.directMessage",
      },
      prismaMock as unknown as typeof prisma,
    );

    expect(publishNotificationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ push: true }),
    );
  });

  it("does not publish a notification the reader silenced on both channels", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(
      createNotificationRecord({ inApp: false }),
    );
    mockReader({
      preferences: [
        { category: "JOB", channel: "IN_APP", enabled: false },
        { category: "JOB", channel: "OS_BANNER", enabled: false },
      ],
    });

    await createNotification(
      notificationInput,
      prismaMock as unknown as typeof prisma,
    );

    // Nothing to render and nothing to interrupt with, so the publish would be
    // an Ably message no client acts on.
    expect(publishNotificationEventMock).not.toHaveBeenCalled();
  });

  it("still publishes in-app, with push off, when the opt-in read fails", async () => {
    const notification = createChatRecord();
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(notification);
    userFindUniqueMock.mockRejectedValue(new Error("db down"));

    await expect(
      createNotification(chatInput, prismaMock as unknown as typeof prisma),
    ).resolves.toEqual({ notification, created: true });
    // Push is additive: a consent-read failure must not cost the in-app toast
    // or the live Notification Center event (ADR-0022).
    expect(publishNotificationEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ push: false }),
    );
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

describe("deletePendingCoworkerAccessNotifications", () => {
  it("deletes SYSTEM pending coworker-access notifications for the access id", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      deletePendingCoworkerAccessNotifications(
        "access_123",
        prismaMock as unknown as typeof prisma,
      ),
    ).resolves.toBe(1);

    expect(prismaMock.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        referenceId: "access_123",
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        kind: NotificationKind.SYSTEM,
      },
    });
  });
});
