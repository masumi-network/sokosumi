import type { Notification } from "@sokosumi/database";
import { beforeEach, expect, it, vi } from "vitest";

const { rows, published, reader, scheduled, assistantRoom } = vi.hoisted(
  () => ({
    rows: [] as Notification[],
    scheduled: [] as string[],
    published: vi.fn(),
    assistantRoom: { kind: "direct" },
    reader: {
      id: "reader",
      pushOptIn: true,
      notificationPreferences: [
        { category: "CHAT_MENTION", channel: "IN_APP", enabled: false },
        { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
        { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: true },
        { category: "CHAT_ROOM_MESSAGE", channel: "OS_BANNER", enabled: true },
      ],
    },
  }),
);

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn().mockResolvedValue(undefined),
  publishNotificationEvent: published,
}));
vi.mock("@/helpers/notification-publish-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notification-publish-queue")>()),
  scheduleNotificationPublish: (id: string) => scheduled.push(id),
}));
vi.mock("@/lib/db/prisma", () => {
  type NotificationData = Omit<
    Notification,
    "id" | "isRead" | "readAt" | "createdAt"
  > &
    Partial<Pick<Notification, "isRead" | "readAt">>;
  function insert(data: NotificationData) {
    const row = {
      ...data,
      id: String(rows.length),
      isRead: data.isRead ?? false,
      readAt: data.readAt ?? null,
      createdAt: new Date(),
    };
    rows.push(row);
    return row;
  }
  const notification = {
    findFirst: async ({ where }: { where: Partial<Notification> }) =>
      rows.find((row) => matches(row, where)) ?? null,
    findUnique: async ({ where }: { where: NotificationWhere }) =>
      rows.find((row) => matches(row, where)) ?? null,
    create: async ({ data }: { data: NotificationData }) => insert(data),
    createMany: async ({ data }: { data: NotificationData }) => {
      if (
        rows.some((row) =>
          matches(row, {
            userId: data.userId,
            kind: data.kind,
            referenceId: data.referenceId,
            eventId: data.eventId,
            messageKey: data.messageKey,
          }),
        )
      )
        return { count: 0 };
      insert(data);
      return { count: 1 };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Partial<Notification>;
      data: Partial<Notification>;
    }) => {
      const matching = rows.filter((row) => matches(row, where));
      for (const row of matching) Object.assign(row, data);
      return { count: matching.length };
    },
    findMany: async ({ where }: { where: Partial<Notification> }) =>
      rows.filter((row) => matches(row, where)),
  };
  const transactionClient = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [{ access: "member", mutedAt: null }],
    notification,
  };

  return {
    default: {
      $transaction: async (
        callback: (tx: typeof transactionClient) => unknown,
      ) => callback(transactionClient),
      user: { findUnique: async () => reader, findMany: async () => [reader] },
      chatRoomUserMember: {
        findMany: async ({ where }: { where: { userId?: { in: string[] } } }) =>
          (where.userId?.in ?? ["author", "reader"]).map((userId) => ({
            access: "member",
            mutedAt: null,
            userId,
          })),
      },
      chatRoomMessage: {
        findUnique: async ({ select }: { select: { room?: unknown } }) =>
          select.room
            ? {
                content: "hello",
                deletedAt: null,
                parentMessageId: null,
                senderCoworker: { name: "Hannah" },
                senderSokoBot: null,
                room: {
                  id: "room",
                  name: "Hannah",
                  groupName: null,
                  organizationId: null,
                  kind: assistantRoom.kind,
                  userMembers: [{ userId: "reader" }],
                  _count: { coworkerMembers: 1, sokoBotMembers: 0 },
                },
              }
            : { content: "hello", deletedAt: null },
      },
      notification,
    },
  };
});

import { emitChatDirectMessageNotifications } from "../chat-direct-message-notifications";
import { emitChatMessageNotifications } from "../chat-human-mentions";
import { emitChatMentionNotifications } from "../chat-mention-notifications";
import { emitChatRoomMessageCreatedEffects } from "../chat-room-message-created-effects";
import { publishNotificationRow } from "../notifications";

type NotificationWhere = Partial<Notification> & {
  userId_kind_referenceId_eventId_messageKey?: Partial<Notification>;
};
function matches(row: Notification, where: NotificationWhere) {
  return Object.entries(
    where.userId_kind_referenceId_eventId_messageKey ?? where,
  ).every(([key, value]) => Reflect.get(row, key) === value);
}

async function emit(messageId: string, mentioned = true) {
  const message = {
    roomId: "room",
    roomName: "General",
    organizationId: null,
    messageId,
    content: "hello",
    authorUserId: "author",
    authorName: "Ada",
    mentionedUserIds: mentioned ? ["reader"] : [],
  };
  await emitChatMentionNotifications({ ...message, roomShape: "channel" });
  await emitChatRoomMessageCreatedEffects({
    ...message,
    roomKind: "channel",
    memberUserIds: ["author", "reader"],
  });
  await drainPublishes();
}

async function drainPublishes() {
  // Drain the queued rows through the real payload builder. Delivery claims have separate tests.
  for (const id of scheduled.splice(0)) {
    const notification = rows.find((item) => item.id === id);
    if (notification) {
      await publishNotificationRow(
        notification,
        {
          inApp: notification.inApp,
          osBanner: notification.publishPush === true,
          email: false,
        },
        notification.publishCreated === true,
      );
      notification.publishId = null;
      notification.publishCreated = null;
    }
  }
}

beforeEach(() => {
  assistantRoom.kind = "direct";
  rows.length = 0;
  scheduled.length = 0;
  reader.notificationPreferences.splice(4);
  const mentionToast = reader.notificationPreferences.find(
    (row) => row.category === "CHAT_MENTION" && row.channel === "IN_APP",
  );
  if (mentionToast) mentionToast.enabled = false;
  published.mockClear();
  const banner = reader.notificationPreferences.find(
    (preference) =>
      preference.category === "CHAT_MENTION" &&
      preference.channel === "OS_BANNER",
  );
  if (banner) banner.enabled = false;
});

it("counts each message once when silenced mentions also produce a counted room row", async () => {
  await emit("message-1");
  await emit("message-2");
  expect(rows.filter((row) => row.inApp)).toHaveLength(1);
  expect(
    published.mock.calls.map(([event]) => event.notification.groupCount),
  ).toEqual([1, 2]);
});

it("preserves banner-only mentions without reviving previously silenced mentions", async () => {
  await emit("message-1");
  const banner = reader.notificationPreferences.find(
    (preference) =>
      preference.category === "CHAT_MENTION" &&
      preference.channel === "OS_BANNER",
  );
  if (banner) banner.enabled = true;
  await emit("message-2");
  expect(rows.filter((row) => row.inApp)).toHaveLength(1);
  expect(
    published.mock.calls.map(([event]) => event.notification.groupCount),
  ).toEqual([1, 2]);
  if (banner) banner.enabled = false;
  await emit("message-3", false);
  expect(published.mock.calls.at(-1)?.[0].notification.groupCount).toBe(3);
});

it("delivers an ordinary Coworker reply as a Direct without requiring a mention", async () => {
  reader.notificationPreferences.push({
    category: "CHAT_DIRECT_MESSAGE",
    channel: "OS_BANNER",
    enabled: true,
  });
  await emitChatMessageNotifications({
    messageId: "assistant-message",
    mentionedUserIds: [],
  });
  await drainPublishes();
  expect(published).toHaveBeenCalledWith(
    expect.objectContaining({
      push: true,
      userId: "reader",
      notification: expect.objectContaining({
        messageKey: "Notifications.Chat.directMessage",
        inApp: true,
        osBanner: true,
      }),
    }),
  );
});

it.each([false, true])(
  "keeps Direct banners when the mention has no banner (mention toast: %s)",
  async (mentionToast) => {
    const toast = reader.notificationPreferences.find(
      (row) => row.category === "CHAT_MENTION" && row.channel === "IN_APP",
    );
    if (toast) toast.enabled = mentionToast;
    reader.notificationPreferences.push({
      category: "CHAT_DIRECT_MESSAGE",
      channel: "OS_BANNER",
      enabled: true,
    });
    const message = {
      roomId: "room",
      roomName: "Alice",
      organizationId: null,
      messageId: "named-message",
      content: "hello",
      authorUserId: "author",
      authorName: "Ada",
      mentionedUserIds: ["reader"],
    };
    await emitChatMentionNotifications({ ...message, roomShape: "pair" });
    await emitChatDirectMessageNotifications({
      ...message,
      recipientUserIds: ["reader"],
    });
    await drainPublishes();
    const direct = published.mock.calls.find(
      ([event]) =>
        event.notification.messageKey === "Notifications.Chat.directMessage",
    )?.[0];
    expect(direct).toMatchObject({
      push: true,
      notification: { inApp: !mentionToast, osBanner: true, groupCount: 1 },
    });
  },
);

it("writes no extra Direct row when its mention already covers every enabled channel", async () => {
  const mentionToast = reader.notificationPreferences.find(
    (row) => row.category === "CHAT_MENTION" && row.channel === "IN_APP",
  );
  if (mentionToast) mentionToast.enabled = true;
  const message = {
    roomId: "room",
    roomName: "Alice",
    organizationId: null,
    messageId: "fully-covered-message",
    content: "hello",
    authorUserId: "author",
    authorName: "Ada",
    mentionedUserIds: ["reader"],
  };
  await emitChatMentionNotifications({ ...message, roomShape: "pair" });
  await emitChatDirectMessageNotifications({
    ...message,
    recipientUserIds: ["reader"],
  });
  expect(rows.map((row) => row.messageKey)).toEqual([
    "Notifications.Chat.mentioned",
  ]);
});

it("delivers opted-in room notifications for assistant channel replies", async () => {
  assistantRoom.kind = "channel";
  await emitChatMessageNotifications({
    messageId: "assistant-channel",
    mentionedUserIds: [],
  });
  await drainPublishes();
  expect(published).toHaveBeenCalledWith(
    expect.objectContaining({
      notification: expect.objectContaining({
        messageKey: "Notifications.Chat.roomMessage",
        osBanner: true,
      }),
    }),
  );
});

it("keeps internal replay receipts out of unread arrival queries", async () => {
  await emit("message-1", false);
  await emit("message-2", false);
  await emit("message-3", false);
  expect(rows.filter((notification) => !notification.isRead)).toHaveLength(1);
  expect(
    published.mock.calls.map(([event]) => event.notification.groupCount),
  ).toEqual([1, 2, 3]);
});
