import { NotificationKind } from "@sokosumi/database";
import type { NotificationCategory } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  resolveNotificationDelivery,
  type StoredNotificationPreference,
  toNotificationCategory,
} from "./notification-delivery";

describe("toNotificationCategory", () => {
  it("maps a job notification to the job category", () => {
    expect(
      toNotificationCategory(NotificationKind.JOB, "Notifications.Job.failed"),
    ).toBe("JOB");
  });

  it("maps a task notification to the task category", () => {
    expect(
      toNotificationCategory(
        NotificationKind.TASK,
        "Notifications.Task.completed",
      ),
    ).toBe("TASK");
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
      JOB: "JOB",
      TASK: "TASK",
      SYSTEM: "SYSTEM",
      // Read with the mention key, so chat answers with one of its two rows.
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
        category: "JOB",
        preferences: NO_PREFERENCES,
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: true });
  });

  it("withholds the banner without account-wide push consent", () => {
    expect(
      resolveNotificationDelivery({
        category: "JOB",
        preferences: NO_PREFERENCES,
        pushOptIn: false,
      }),
    ).toEqual({ inApp: true, osBanner: false });
  });

  it("stops delivering in-app when the reader turned that cell off", () => {
    expect(
      resolveNotificationDelivery({
        category: "TASK",
        preferences: [{ category: "TASK", channel: "IN_APP", enabled: false }],
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
        preferences: [{ category: "JOB", channel: "IN_APP", enabled: false }],
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
