import { describe, expect, it } from "vitest";

import type { NotificationItem } from "@/lib/clients/generated/core";

import {
  mergeProviderNotifications,
  removeNotificationLocally,
} from "./use-notifications-page";

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

  it("leaves a row the page deleted from beyond the provider window out", () => {
    // The page pages further back than shared state holds, so it deletes a row
    // the provider never had. The merge must not bring the row back.
    const held = notification("held");
    const deleted = notification("deleted");
    const pageList = removeNotificationLocally([held, deleted], "deleted");

    expect(mergeProviderNotifications(pageList, [held])).toEqual([held]);
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

describe("removeNotificationLocally", () => {
  it("drops the deleted row and keeps the order of the rest", () => {
    const first = notification("first");
    const second = notification("second");
    const third = notification("third");

    expect(removeNotificationLocally([first, second, third], "second")).toEqual(
      [first, third],
    );
  });

  it("returns the same list when it holds no such row", () => {
    const rows = [notification("first")];

    expect(removeNotificationLocally(rows, "missing")).toBe(rows);
  });

  it("empties a list whose only row was deleted", () => {
    expect(removeNotificationLocally([notification("only")], "only")).toEqual(
      [],
    );
  });
});
