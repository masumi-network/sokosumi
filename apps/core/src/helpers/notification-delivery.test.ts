import { NotificationKind } from "@sokosumi/database";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  JOB_ATTENTION_MESSAGE_KEYS,
  resolveNotificationDelivery,
  resolveNotificationMatrix,
  type StoredNotificationPreference,
  TASK_ATTENTION_MESSAGE_KEYS,
  toNotificationCategory,
} from "./notification-delivery";

describe("toNotificationCategory", () => {
  it("splits jobs by whether the reader has to do something", () => {
    expect(
      toNotificationCategory(
        NotificationKind.JOB,
        "Notifications.Job.inputRequired",
      ),
    ).toBe("JOB_ATTENTION");
    expect(
      toNotificationCategory(NotificationKind.JOB, "Notifications.Job.failed"),
    ).toBe("JOB_UPDATE");
  });

  it("splits tasks the same way", () => {
    expect(
      toNotificationCategory(
        NotificationKind.TASK,
        "Notifications.Task.approvalRequired",
      ),
    ).toBe("TASK_ATTENTION");
    expect(
      toNotificationCategory(
        NotificationKind.TASK,
        "Notifications.Task.completed",
      ),
    ).toBe("TASK_UPDATE");
  });

  /**
   * Written out rather than looped over the exported lists: a loop over the
   * list cannot notice a key dropped from it, and a dropped key silently
   * demotes a notification the reader asked to be interrupted for.
   */
  it("names every key that waits on the reader", () => {
    expect(JOB_ATTENTION_MESSAGE_KEYS).toEqual([
      "Notifications.Job.inputRequired",
      "Notifications.Job.paymentFailed",
    ]);
    expect(TASK_ATTENTION_MESSAGE_KEYS).toEqual([
      "Notifications.Task.inputRequired",
      "Notifications.Task.approvalRequired",
      "Notifications.Task.authenticationRequired",
      "Notifications.Task.outOfCredits",
      "Notifications.Task.scheduleRemovedByOperator",
    ]);
  });

  it("puts every listed attention key on the loud row", () => {
    for (const key of JOB_ATTENTION_MESSAGE_KEYS) {
      expect(toNotificationCategory(NotificationKind.JOB, key)).toBe(
        "JOB_ATTENTION",
      );
    }
    for (const key of TASK_ATTENTION_MESSAGE_KEYS) {
      expect(toNotificationCategory(NotificationKind.TASK, key)).toBe(
        "TASK_ATTENTION",
      );
    }
  });

  /**
   * The quiet row is the fallback, so a key nobody has classified cannot make
   * itself louder than the reader asked for.
   */
  it("treats a task key it does not know as an update", () => {
    expect(
      toNotificationCategory(NotificationKind.TASK, "Notifications.Task.wat"),
    ).toBe("TASK_UPDATE");
  });

  it("maps a system notification to the system category", () => {
    expect(
      toNotificationCategory(
        NotificationKind.SYSTEM,
        "notifications.vendorGrant.pending",
      ),
    ).toBe("SYSTEM");
  });

  it("splits chat by message key, because the reader chooses between them", () => {
    expect(
      toNotificationCategory(NotificationKind.CHAT, CHAT_MENTION_MESSAGE_KEY),
    ).toBe("CHAT_MENTION");
    expect(
      toNotificationCategory(
        NotificationKind.CHAT,
        CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
      ),
    ).toBe("CHAT_DIRECT_MESSAGE");
  });

  it("gives every message in a room its own row", () => {
    expect(
      toNotificationCategory(
        NotificationKind.CHAT,
        "Notifications.Chat.roomMessage",
      ),
    ).toBe("CHAT_ROOM_MESSAGE");
  });

  it("has no category for a chat key it does not know", () => {
    expect(
      toNotificationCategory(NotificationKind.CHAT, "Notifications.Chat.wat"),
    ).toBeNull();
  });

  it("has no category for billing, which nothing emits yet", () => {
    expect(
      toNotificationCategory(NotificationKind.BILLING, "whatever"),
    ).toBeNull();
  });

  /**
   * A kind added later fails to compile here, so someone decides which row it
   * belongs to rather than letting it fall through to the defaults unnoticed.
   */
  it("has an answer for every kind Core can store", () => {
    const EXPECTED: Record<NotificationKind, NotificationCategory | null> = {
      // Read with the mention key, which is no job or task key, so those two
      // answer with their quiet row.
      JOB: "JOB_UPDATE",
      TASK: "TASK_UPDATE",
      SYSTEM: "SYSTEM",
      CHAT: "CHAT_MENTION",
      BILLING: null,
    };

    for (const kind of Object.values(NotificationKind)) {
      expect(toNotificationCategory(kind, CHAT_MENTION_MESSAGE_KEY)).toBe(
        EXPECTED[kind],
      );
    }
  });
});

describe("resolveNotificationDelivery", () => {
  const NO_PREFERENCES: StoredNotificationPreference[] = [];

  it("delivers on both channels for a reader who set nothing", () => {
    expect(
      resolveNotificationDelivery({
        category: "JOB_ATTENTION",
        preferences: NO_PREFERENCES,
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: true });
  });

  it("withholds the banner without account-wide push consent", () => {
    expect(
      resolveNotificationDelivery({
        category: "JOB_ATTENTION",
        preferences: NO_PREFERENCES,
        pushOptIn: false,
      }),
    ).toEqual({ inApp: true, osBanner: false });
  });

  it("stops delivering in-app when the reader turned that cell off", () => {
    expect(
      resolveNotificationDelivery({
        category: "TASK_UPDATE",
        preferences: [
          { category: "TASK_UPDATE", channel: "IN_APP", enabled: false },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: false, osBanner: true });
  });

  it("stops interrupting when the reader turned that banner cell off", () => {
    expect(
      resolveNotificationDelivery({
        category: "CHAT_MENTION",
        preferences: [
          { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: false });
  });

  it("keeps one category's choice out of another's", () => {
    expect(
      resolveNotificationDelivery({
        category: "CHAT_DIRECT_MESSAGE",
        preferences: [
          { category: "CHAT_MENTION", channel: "IN_APP", enabled: false },
          { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: true });
  });

  it("falls back to the defaults for a notification with no category", () => {
    expect(
      resolveNotificationDelivery({
        category: null,
        preferences: [
          { category: "JOB_ATTENTION", channel: "IN_APP", enabled: false },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: true });
  });

  it("ignores a stored channel it does not recognise", () => {
    expect(
      resolveNotificationDelivery({
        category: "SYSTEM",
        preferences: [{ category: "SYSTEM", channel: "EMAIL", enabled: false }],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: true });
  });
});

describe("resolveNotificationDelivery for every message in a room", () => {
  it("delivers nothing for a reader who stored nothing", () => {
    expect(
      resolveNotificationDelivery({
        category: "CHAT_ROOM_MESSAGE",
        preferences: [],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: false, osBanner: false });
  });

  it("delivers once the reader turns the row on", () => {
    expect(
      resolveNotificationDelivery({
        category: "CHAT_ROOM_MESSAGE",
        preferences: [
          { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: true },
          {
            category: "CHAT_ROOM_MESSAGE",
            channel: "OS_BANNER",
            enabled: true,
          },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: true });
  });
});

describe("resolveNotificationMatrix", () => {
  it("answers for every cell, so the reader sees a complete matrix", () => {
    const matrix = resolveNotificationMatrix([]);

    expect(matrix).toHaveLength(
      NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length,
    );
    expect(
      matrix
        .filter((cell) => cell.category !== "CHAT_ROOM_MESSAGE")
        .every((cell) => cell.enabled),
    ).toBe(true);
    expect(matrix).toContainEqual({
      category: "CHAT_MENTION",
      channel: "OS_BANNER",
      enabled: true,
    });
  });

  /**
   * Every message in a room is the one row nobody receives today, so it is the
   * one row that starts off. Reading it as on would turn a busy room into a
   * stream of notifications for readers who never opened this page.
   */
  it("leaves every message in a room off until the reader asks", () => {
    const matrix = resolveNotificationMatrix([]);

    expect(matrix).toContainEqual({
      category: "CHAT_ROOM_MESSAGE",
      channel: "IN_APP",
      enabled: false,
    });
    expect(matrix).toContainEqual({
      category: "CHAT_ROOM_MESSAGE",
      channel: "OS_BANNER",
      enabled: false,
    });
  });

  it("gives every message in a room the reader's own answer once they store one", () => {
    const matrix = resolveNotificationMatrix([
      { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: true },
    ]);

    expect(matrix).toContainEqual({
      category: "CHAT_ROOM_MESSAGE",
      channel: "IN_APP",
      enabled: true,
    });
  });

  it("shows the reader's own choice where they made one", () => {
    const matrix = resolveNotificationMatrix([
      { category: "JOB_ATTENTION", channel: "IN_APP", enabled: false },
    ]);

    expect(matrix).toContainEqual({
      category: "JOB_ATTENTION",
      channel: "IN_APP",
      enabled: false,
    });
    expect(matrix).toContainEqual({
      category: "JOB_ATTENTION",
      channel: "OS_BANNER",
      enabled: true,
    });
  });

  /**
   * A row written by an older build, for a category or channel this one no
   * longer has. It belongs to no cell, so it cannot appear as one.
   */
  it("drops a stored row that names nothing this build knows", () => {
    const matrix = resolveNotificationMatrix([
      { category: "PIGEON", channel: "IN_APP", enabled: false },
      { category: "JOB_ATTENTION", channel: "CARRIER_PIGEON", enabled: false },
    ]);

    expect(matrix).toHaveLength(
      NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length,
    );
    expect(
      matrix
        .filter((cell) => cell.category !== "CHAT_ROOM_MESSAGE")
        .every((cell) => cell.enabled),
    ).toBe(true);
  });
});
