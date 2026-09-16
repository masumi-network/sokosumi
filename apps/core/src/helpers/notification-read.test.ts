import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notificationFeedWhere } from "@/helpers/notification-feed";

import { markNotificationsRead } from "./notification-read";

const { notificationUpdateManyAndReturnMock } = vi.hoisted(() => ({
  notificationUpdateManyAndReturnMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    notification: {
      updateManyAndReturn: notificationUpdateManyAndReturnMock,
    },
  },
}));

describe("markNotificationsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationUpdateManyAndReturnMock.mockResolvedValue([]);
  });

  it("guards the write with the reader and the feed rule when given no scope", async () => {
    await markNotificationsRead("user_123");

    expect(notificationUpdateManyAndReturnMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        ...notificationFeedWhere(),
      },
      data: { isRead: true, readAt: expect.any(Date) },
      select: { id: true, kind: true, messageKey: true },
    });
  });

  it("narrows with the scope without letting it drop a guard", async () => {
    // The scope is spread first, so a caller cannot widen the write by
    // passing the same keys the guards use.
    await markNotificationsRead("user_123", {
      id: { in: ["notif_1"] },
      userId: "someone_else",
      isRead: true,
    });

    expect(notificationUpdateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["notif_1"] },
          userId: "user_123",
          isRead: false,
        }),
      }),
    );
  });

  it("returns only the room rows a banner stands for", async () => {
    notificationUpdateManyAndReturnMock.mockResolvedValue([
      {
        id: "notif_room",
        kind: NotificationKind.CHAT,
        messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY,
      },
      {
        id: "notif_mention",
        kind: NotificationKind.CHAT,
        messageKey: CHAT_MENTION_MESSAGE_KEY,
      },
      {
        id: "notif_job",
        kind: NotificationKind.JOB,
        messageKey: "Notifications.Job.completed",
      },
    ]);

    const result = await markNotificationsRead("user_123");

    expect(result.count).toBe(3);
    expect(result.clearedRoomIds).toEqual(["notif_room"]);
  });
});
