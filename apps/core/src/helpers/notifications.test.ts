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
  publishClearedNotifications,
  publishNotificationRow,
} from "./notifications";

const {
  publishNotificationEventMock,
  userFindUniqueMock,
  notificationFindManyMock,
} = vi.hoisted(() => ({
  publishNotificationEventMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishNotificationEvent: publishNotificationEventMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    notification: {
      findMany: notificationFindManyMock,
    },
  },
}));

const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
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
        // Written by this event, so a reader's tab counts it on the badge.
        created: true,
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

  /**
   * The banner is off until a reader asks for it, so a test about the push
   * gate says which row asked. The gate under test is the account-wide opt-in,
   * and a row that never asked would hide it behind a second answer.
   */
  function bannerOn(category: string) {
    return [{ category, channel: "OS_BANNER", enabled: true }];
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
    mockReader({ pushOptIn: true, preferences: bannerOn("CHAT_MENTION") });

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

  /**
   * The row each kind lands on with this input's message key. Billing has
   * none: the matrix holds no row for it, so it keeps both channels and there
   * is nothing for a reader to ask for.
   */
  const KIND_CATEGORY: Partial<Record<NotificationKind, string>> = {
    [NotificationKind.JOB]: "JOB_COMPLETED",
    [NotificationKind.TASK]: "TASK_UPDATE",
    [NotificationKind.SYSTEM]: "SYSTEM",
  };

  for (const kind of NON_CHAT_KINDS) {
    it(`pushes a ${kind} notification when the user opted in`, async () => {
      const prismaMock = createPrismaMock();
      prismaMock.notification.create.mockResolvedValue(
        createNotificationRecord({ kind }),
      );
      const category = KIND_CATEGORY[kind];
      mockReader({
        pushOptIn: true,
        preferences: category ? bannerOn(category) : [],
      });

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
    mockReader({ pushOptIn: true, preferences: bannerOn("CHAT_MENTION") });

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
      preferences: [
        { category: "JOB_COMPLETED", channel: "IN_APP", enabled: false },
        { category: "JOB_COMPLETED", channel: "OS_BANNER", enabled: true },
      ],
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
      preferences: [
        { category: "JOB_COMPLETED", channel: "OS_BANNER", enabled: false },
      ],
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

  it("splits the chat rows, so muting mentions leaves direct messages alone", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(createChatRecord());
    mockReader({
      preferences: [
        { category: "CHAT_MENTION", channel: "IN_APP", enabled: false },
        { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
        ...bannerOn("CHAT_DIRECT_MESSAGE"),
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
        { category: "JOB_COMPLETED", channel: "IN_APP", enabled: false },
        { category: "JOB_COMPLETED", channel: "OS_BANNER", enabled: false },
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

/**
 * How many messages are waiting for the reader in a room, sent with every
 * chat notification so a banner standing for the whole room can say so.
 *
 * The banner replaces the one before it, and the service worker can query
 * nothing, so the number has to arrive with the payload (ADR-0023).
 */
describe("chat room arrival count", () => {
  beforeEach(() => {
    userFindUniqueMock.mockReset();
    userFindUniqueMock.mockResolvedValue({
      pushOptIn: true,
      notificationPreferences: [],
    });
    publishNotificationEventMock.mockReset();
    publishNotificationEventMock.mockResolvedValue(undefined);
    notificationFindManyMock.mockReset();
    notificationFindManyMock.mockResolvedValue([]);
  });

  const chatInput: CreateNotificationInput = {
    ...notificationInput,
    kind: NotificationKind.CHAT,
    referenceId: "room_123",
    eventId: "chat_message_123",
    messageKey: "Notifications.Chat.mentioned",
    messageParams: { authorName: "Alice", roomName: "General" },
    metadata: { roomId: "room_123" },
  };

  function chatRecord(overrides: Partial<Notification> = {}): Notification {
    return createNotificationRecord({
      kind: chatInput.kind,
      referenceId: chatInput.referenceId,
      eventId: chatInput.eventId,
      messageKey: chatInput.messageKey,
      messageParams: JSON.stringify(chatInput.messageParams),
      metadata: JSON.stringify(chatInput.metadata),
      ...overrides,
    });
  }

  /** The count the publish carried, or undefined when it carried none. */
  function publishedGroupCount(): unknown {
    const call = publishNotificationEventMock.mock.calls.at(-1)?.[0] as
      | { notification: Record<string, unknown> }
      | undefined;
    return call?.notification.groupCount;
  }

  /**
   * A room's messages are counted onto one row, so counting rows would read
   * eleven messages and a mention as two. The row says what it stands for.
   */
  it("sums what each unread row in the room stands for", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "counted_row",
        inApp: true,
        metadata: null,
        messageParams: JSON.stringify({ roomName: "General", count: 4 }),
      },
      {
        id: "uncounted_row",
        inApp: true,
        metadata: null,
        messageParams: JSON.stringify({ authorName: "Alice" }),
      },
    ]);
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(chatRecord());

    await createNotification(chatInput, prismaMock as unknown as typeof prisma);

    expect(publishedGroupCount()).toBe(5);
    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: chatInput.userId,
        kind: NotificationKind.CHAT,
        referenceId: chatInput.referenceId,
        isRead: false,
      },
      select: { id: true, messageParams: true, inApp: true, metadata: true },
    });
  });

  it("counts a room holding only this arrival as one", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "only_row",
        inApp: true,
        metadata: null,
        messageParams: JSON.stringify({ authorName: "Alice" }),
      },
    ]);
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(chatRecord());

    await createNotification(chatInput, prismaMock as unknown as typeof prisma);

    expect(publishedGroupCount()).toBe(1);
  });

  /** Params nobody can read still stand for the message that wrote them. */
  it("counts a row whose params will not parse as one message", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notification_1",
        inApp: true,
        metadata: null,
        messageParams: "not json",
      },
      {
        id: "notification_2",
        inApp: true,
        metadata: null,
        messageParams: JSON.stringify({ count: "many" }),
      },
    ]);
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(chatRecord());

    await createNotification(chatInput, prismaMock as unknown as typeof prisma);

    expect(publishedGroupCount()).toBe(2);
  });

  /**
   * The count it undercounts by is invisible from outside: a banner saying
   * four when nine are waiting reads exactly like a banner saying four. So
   * the row that will not read is what is said, and it is said once per row.
   */
  it("reports each row it could not read the count from", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "arrival_throwing",
        inApp: true,
        metadata: null,
        messageParams: "door code 4417, written raw into the column",
      },
      {
        id: "arrival_bare_number",
        inApp: true,
        metadata: null,
        messageParams: "12",
      },
    ]);
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(chatRecord());

    await createNotification(chatInput, prismaMock as unknown as typeof prisma);

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "A notification row will not read: SyntaxError",
      }),
      expect.objectContaining({
        extra: expect.objectContaining({
          rowId: "arrival_throwing",
          field: "messageParams",
        }),
      }),
    );
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "A notification row will not read: it is not an object",
      }),
      expect.objectContaining({
        extra: expect.objectContaining({ rowId: "arrival_bare_number" }),
      }),
    );
    // `message` and `stack` are non-enumerable, so serialising the calls
    // alone would pass whatever the Error was built from.
    const said = captureExceptionMock.mock.calls
      .flat()
      .map((argument) =>
        argument instanceof Error
          ? `${argument.message} ${argument.stack}`
          : JSON.stringify(argument),
      )
      .join(" ");
    expect(said).not.toContain("door code");
  });

  it.each([null, "{}", '{"osBannerEligible":"true"}', "invalid json"])(
    "omits an uncertain count when a hidden row has metadata %s",
    async (metadata) => {
      notificationFindManyMock.mockResolvedValue([
        chatRecord(),
        chatRecord({ inApp: false, metadata }),
      ]);
      await publishNotificationRow(chatRecord(), {
        inApp: true,
        osBanner: true,
      });
      expect(publishNotificationEventMock).toHaveBeenCalledTimes(1);
      expect(publishedGroupCount()).toBeUndefined();
    },
  );

  /**
   * The hidden row's own column is read the same way the count is. Parsed in
   * the loop, a column that will not read threw into the generic catch, which
   * fires on every publish of every message and names no row. The count it
   * costs is the same either way: a hidden row that cannot say whether it was
   * banner-only takes the whole count down with it.
   */
  it("names a hidden row whose metadata will not read, once", async () => {
    notificationFindManyMock.mockResolvedValue([
      chatRecord(),
      chatRecord({
        id: "hidden_unreadable",
        inApp: false,
        metadata: "door code 4417, written raw into the column",
      }),
    ]);

    await publishNotificationRow(chatRecord(), { inApp: true, osBanner: true });
    await publishNotificationRow(chatRecord(), { inApp: true, osBanner: true });

    expect(publishedGroupCount()).toBeUndefined();
    const named = captureExceptionMock.mock.calls.filter(
      (call) =>
        (call[1] as { extra?: { rowId?: string } })?.extra?.rowId ===
        "hidden_unreadable",
    );
    expect(named).toHaveLength(1);
    const said = captureExceptionMock.mock.calls
      .flat()
      .map((argument) =>
        argument instanceof Error
          ? `${argument.message} ${argument.stack}`
          : JSON.stringify(argument),
      )
      .join(" ");
    expect(said).not.toContain("door code");
  });

  it("omits the count when a concurrent read leaves no unread rows", async () => {
    notificationFindManyMock.mockResolvedValue([]);
    await publishNotificationRow(chatRecord(), { inApp: true, osBanner: true });
    expect(publishNotificationEventMock).toHaveBeenCalledTimes(1);
    expect(publishedGroupCount()).toBeUndefined();
  });

  /** Only chat collapses into one banner. A job happened once. */
  it("sends no count with a notification that is not chat", async () => {
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(
      createNotificationRecord(),
    );

    await createNotification(
      notificationInput,
      prismaMock as unknown as typeof prisma,
    );

    expect(publishedGroupCount()).toBeUndefined();
    expect(notificationFindManyMock).not.toHaveBeenCalled();
  });

  /**
   * A cleared row is published to take a banner down, not to raise one. The
   * count would be the rooms the reader has left to read, on a row about the
   * one they just finished.
   */
  it("sends no count with a row that is already read", async () => {
    await publishNotificationRow(
      chatRecord({ isRead: true, readAt: READ_AT }),
      { inApp: true, osBanner: false },
      false,
    );

    expect(publishedGroupCount()).toBeUndefined();
    expect(notificationFindManyMock).not.toHaveBeenCalled();
  });

  /**
   * The banner matters more than the number on it. A failed count must not
   * cost the reader the interruption itself.
   */
  it("still publishes when the arrivals cannot be counted", async () => {
    notificationFindManyMock.mockRejectedValue(new Error("database gone"));
    const prismaMock = createPrismaMock();
    prismaMock.notification.create.mockResolvedValue(chatRecord());

    await createNotification(chatInput, prismaMock as unknown as typeof prisma);

    expect(publishNotificationEventMock).toHaveBeenCalledTimes(1);
    expect(publishedGroupCount()).toBeUndefined();
  });
});

/**
 * How a banner and a bell learn that rows they stand for are finished with.
 *
 * Three callers, one word: the room-read route clears a whole room, and the
 * Notification Center clears one row or every row it lists. A reader's open
 * tabs act on the row itself rather than on an id, because a tab holding it
 * replaces what it holds and a tab that never loaded it can tell it from a
 * new arrival.
 */
describe("publishClearedNotifications", () => {
  beforeEach(() => {
    publishNotificationEventMock.mockReset();
    publishNotificationEventMock.mockResolvedValue(undefined);
    notificationFindManyMock.mockReset();
    captureExceptionMock.mockReset();
    userFindUniqueMock.mockReset();
    userFindUniqueMock.mockResolvedValue({
      pushOptIn: true,
      notificationPreferences: [],
    });
  });

  /**
   * None of them raises a banner: nothing arrived, one stopped waiting. The
   * `created` flag is false, so no tab counts the row towards the badge a
   * second time, and each row carries its own in-app answer.
   */
  it("publishes each cleared row, raising no banner", async () => {
    notificationFindManyMock.mockResolvedValue([
      createNotificationRecord({
        id: "notification_1",
        isRead: true,
        readAt: READ_AT,
      }),
      createNotificationRecord({
        id: "notification_2",
        isRead: true,
        readAt: READ_AT,
        inApp: false,
      }),
    ]);

    await publishClearedNotifications(["notification_1", "notification_2"]);

    expect(publishNotificationEventMock).toHaveBeenCalledTimes(2);
    expect(publishNotificationEventMock.mock.calls[0]?.[0]).toMatchObject({
      push: false,
      notification: { id: "notification_1", inApp: true, created: false },
    });
    expect(publishNotificationEventMock.mock.calls[1]?.[0]).toMatchObject({
      push: false,
      notification: { id: "notification_2", inApp: false, created: false },
    });
  });

  it("reads nothing and publishes nothing for an empty list", async () => {
    await publishClearedNotifications([]);

    expect(notificationFindManyMock).not.toHaveBeenCalled();
    expect(publishNotificationEventMock).not.toHaveBeenCalled();
  });

  /**
   * This runs after the reader has been answered, so a failed read must not
   * leave a rejected promise behind it. The rows come back on the next fetch,
   * so the cost is a bell that lags and a banner the reader dismisses.
   */
  it("swallows a failed read rather than rejecting behind the response", async () => {
    notificationFindManyMock.mockRejectedValue(new Error("db down"));

    await expect(
      publishClearedNotifications(["notification_1"]),
    ).resolves.toBeUndefined();
    expect(publishNotificationEventMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
