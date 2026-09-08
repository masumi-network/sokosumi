import type { Notification } from "@sokosumi/database";
import { beforeEach, expect, it, vi } from "vitest";

const { rows, published, reader } = vi.hoisted(() => ({
  rows: [] as Notification[],
  published: vi.fn(),
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
}));

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/ably/publish", () => ({ publishNotificationEvent: published }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: async () => reader, findMany: async () => [reader] },
    chatRoomUserMember: { findMany: async () => [] },
    chatRoomMessage: {
      findUnique: async () => ({ content: "hello", deletedAt: null }),
    },
    notification: {
      findFirst: async ({ where }: { where: Partial<Notification> }) =>
        rows.find((row) => matches(row, where)) ?? null,
      findUnique: async ({ where }: { where: Partial<Notification> }) =>
        rows.find((row) => matches(row, where)) ?? null,
      create: async ({
        data,
      }: {
        data: Omit<Notification, "id" | "isRead" | "readAt" | "createdAt">;
      }) => {
        const row = {
          ...data,
          id: String(rows.length),
          isRead: false,
          readAt: null,
          createdAt: new Date(),
        };
        rows.push(row);
        return row;
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
    },
  },
}));

import { emitChatMentionNotifications } from "../chat-mention-notifications";
import { emitChatRoomMessageNotifications } from "../chat-room-message-notifications";

function matches(row: Notification, where: Partial<Notification>) {
  return Object.entries(where).every(
    ([key, value]) => Reflect.get(row, key) === value,
  );
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
  await emitChatMentionNotifications(message);
  await emitChatRoomMessageNotifications({
    ...message,
    roomKind: "channel",
    memberUserIds: ["author", "reader"],
  });
}

beforeEach(() => {
  rows.length = 0;
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
  expect(rows).toHaveLength(3);
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
  expect(rows).toHaveLength(3);
  expect(
    published.mock.calls.map(([event]) => event.notification.groupCount),
  ).toEqual([1, 2]);
  if (banner) banner.enabled = false;
  await emit("message-3", false);
  expect(published.mock.calls.at(-1)?.[0].notification.groupCount).toBe(3);
});
