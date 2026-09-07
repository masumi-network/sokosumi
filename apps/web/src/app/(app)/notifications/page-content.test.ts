import { describe, expect, it } from "vitest";

import type { NotificationItem } from "@/lib/clients/generated/core";

import { mergeProviderNotifications } from "./page-content";

function notification(
  id: string,
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id,
    userId: "user-1",
    kind: "CHAT",
    referenceId: "room-1",
    eventId: "message-1",
    messageKey: "Notifications.Chat.roomMessage",
    messageParams: { authorName: "Ada", roomName: "Design" },
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-01-01T09:00:00.000Z"),
    ...overrides,
  };
}

describe("mergeProviderNotifications", () => {
  it("moves a changed row to the front with its latest count", () => {
    const room = notification("room");
    const job = notification("job", { kind: "JOB" });
    const changedRoom = notification("room", {
      messageParams: { roomName: "Design", count: 2 },
      createdAt: new Date("2026-01-01T11:00:00.000Z"),
    });

    const merged = mergeProviderNotifications([job, room], [changedRoom, job]);

    expect(merged).toEqual([changedRoom, job]);
  });

  it("keeps loaded rows outside the provider window", () => {
    const first = notification("first");
    const older = notification("older");

    expect(mergeProviderNotifications([first, older], [first])).toEqual([
      first,
      older,
    ]);
  });
});
