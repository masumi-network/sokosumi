import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  JOB_FOLLOW_UP_MESSAGE_KEY,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EMAIL_CATEGORIES,
  type NotificationCategory,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  resolveNotificationDelivery,
  resolveNotificationMatrix,
  type StoredNotificationPreference,
  TASK_ATTENTION_MESSAGE_KEYS,
  TASK_COMPLETED_MESSAGE_KEY,
  toNotificationCategory,
} from "./notification-delivery";

describe("toNotificationCategory", () => {
  /**
   * A job has no row to answer to since SOK-930: nothing writes a JOB
   * notification any more, so the matrix holds no switch for one. A stored row
   * from before that keeps its defaults rather than a category that is gone.
   */
  it("gives a job no row of the matrix", () => {
    expect(
      toNotificationCategory(
        NotificationKind.JOB,
        "Notifications.Job.inputRequired",
      ),
    ).toBeNull();
    expect(
      toNotificationCategory(NotificationKind.JOB, "Notifications.Job.failed"),
    ).toBeNull();
  });

  it("splits tasks three ways", () => {
    expect(
      toNotificationCategory(
        NotificationKind.TASK,
        "Notifications.Task.approvalRequired",
      ),
    ).toBe("TASK_ATTENTION");
    expect(
      toNotificationCategory(
        NotificationKind.TASK,
        "Notifications.Task.canceled",
      ),
    ).toBe("TASK_UPDATE");
  });

  /**
   * The row the reader started the task for. It is written out rather than
   * read from the constant on both sides, so renaming the constant cannot
   * quietly move a finished task back in with the cancellations.
   */
  it("gives a finished task a row of its own", () => {
    expect(TASK_COMPLETED_MESSAGE_KEY).toBe("Notifications.Task.completed");
    expect(
      toNotificationCategory(
        NotificationKind.TASK,
        "Notifications.Task.completed",
      ),
    ).toBe("TASK_COMPLETED");
  });

  /**
   * The one row that answers for three kinds. A reader decides about reminders
   * once, so every follow-up key lands here whatever it is a reminder of.
   */
  it("gives every follow-up the same row, whatever kind it reminds of", () => {
    expect(
      toNotificationCategory(
        NotificationKind.CHAT,
        CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
      ),
    ).toBe("FOLLOW_UP");
    expect(
      toNotificationCategory(
        NotificationKind.CHAT,
        CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
      ),
    ).toBe("FOLLOW_UP");
    expect(
      toNotificationCategory(NotificationKind.TASK, TASK_FOLLOW_UP_MESSAGE_KEY),
    ).toBe("FOLLOW_UP");
    expect(
      toNotificationCategory(NotificationKind.JOB, JOB_FOLLOW_UP_MESSAGE_KEY),
    ).toBe("FOLLOW_UP");
  });

  /**
   * A chat follow-up must not fall through to the direct-message row. It would
   * be silenced by a preference about messages rather than about reminders, and
   * the reader who switched messages off is exactly the one the reminder is for.
   */
  it("does not read a chat follow-up as the message it reminds of", () => {
    expect(
      toNotificationCategory(
        NotificationKind.CHAT,
        CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
      ),
    ).not.toBe("CHAT_DIRECT_MESSAGE");
  });

  /**
   * Written out rather than looped over the exported lists: a loop over the
   * list cannot notice a key dropped from it, and a dropped key silently
   * demotes a notification the reader asked to be interrupted for.
   */
  it("names every key that waits on the reader", () => {
    expect(TASK_ATTENTION_MESSAGE_KEYS).toEqual([
      "Notifications.Task.assigned",
      "Notifications.Task.inputRequired",
      "Notifications.Task.approvalRequired",
      "Notifications.Task.authenticationRequired",
      "Notifications.Task.outOfCredits",
      "Notifications.Task.scheduleRemovedByOperator",
    ]);
  });

  it("puts every listed attention key on the loud row", () => {
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
      // Read with the mention key, which is no task key, so that one answers
      // with its quiet row. A job answers with nothing at all (SOK-930).
      JOB: null,
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

  /**
   * The device is what a reader asks for, one group at a time. Until they do,
   * a stored nothing is Sokosumi and the inbox and no banner, whatever
   * consent stands.
   */
  it("delivers in Sokosumi and the inbox, and not on the device, for a reader who set nothing", () => {
    expect(
      resolveNotificationDelivery({
        category: "TASK_ATTENTION",
        preferences: NO_PREFERENCES,
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: false, email: true });
  });

  it("withholds the banner without account-wide push consent", () => {
    expect(
      resolveNotificationDelivery({
        category: "TASK_ATTENTION",
        preferences: [
          { category: "TASK_ATTENTION", channel: "OS_BANNER", enabled: true },
        ],
        pushOptIn: false,
      }),
    ).toEqual({ inApp: true, osBanner: false, email: true });
  });

  it("stops delivering in-app when the reader turned that cell off", () => {
    expect(
      resolveNotificationDelivery({
        category: "TASK_UPDATE",
        preferences: [
          { category: "TASK_UPDATE", channel: "IN_APP", enabled: false },
          { category: "TASK_UPDATE", channel: "OS_BANNER", enabled: true },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: false, osBanner: true, email: false });
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
    ).toEqual({ inApp: true, osBanner: false, email: true });
  });

  it("keeps one category's choice out of another's", () => {
    expect(
      resolveNotificationDelivery({
        category: "CHAT_DIRECT_MESSAGE",
        preferences: [
          { category: "CHAT_MENTION", channel: "IN_APP", enabled: false },
          { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
          { category: "CHAT_MENTION", channel: "EMAIL", enabled: false },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: false, email: true });
  });

  it("falls back to the defaults for a notification with no category", () => {
    expect(
      resolveNotificationDelivery({
        category: null,
        preferences: [
          { category: "TASK_ATTENTION", channel: "IN_APP", enabled: false },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: true, email: false });
  });

  it("ignores a stored channel it does not recognise", () => {
    expect(
      resolveNotificationDelivery({
        category: "SYSTEM",
        preferences: [
          // A channel no vocabulary holds. `EMAIL` used to stand here and
          // stopped being unrecognised the day it joined the vocabulary, which
          // left this pinning nothing (SOK-916).
          { category: "SYSTEM", channel: "CARRIER_PIGEON", enabled: false },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: false, email: true });
  });

  /**
   * The row Core will never mail. A stored cell saying otherwise is somebody's
   * old preference or a write the page should not have made, and it must not
   * turn into an email.
   */
  it("ignores a stored email cell on a category that does not mail", () => {
    expect(
      resolveNotificationDelivery({
        category: "TASK_UPDATE",
        preferences: [
          { category: "TASK_UPDATE", channel: "EMAIL", enabled: true },
        ],
        pushOptIn: true,
      }),
    ).toEqual({ inApp: true, osBanner: false, email: false });
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
    ).toEqual({ inApp: false, osBanner: false, email: false });
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
    ).toEqual({ inApp: true, osBanner: true, email: false });
  });
});

describe("resolveNotificationDelivery for a reminder", () => {
  it("emails a reader who has set nothing", () => {
    expect(
      resolveNotificationDelivery({
        category: "FOLLOW_UP",
        preferences: [],
        pushOptIn: false,
      }),
    ).toEqual({ inApp: true, osBanner: false, email: true });
  });

  it("stops emailing once the reader turns that cell off", () => {
    expect(
      resolveNotificationDelivery({
        category: "FOLLOW_UP",
        preferences: [
          { category: "FOLLOW_UP", channel: "EMAIL", enabled: false },
        ],
        pushOptIn: false,
      }),
    ).toEqual({ inApp: true, osBanner: false, email: false });
  });

  it("keeps the reminder in Sokosumi when only the email is off", () => {
    const delivery = resolveNotificationDelivery({
      category: "FOLLOW_UP",
      preferences: [
        { category: "FOLLOW_UP", channel: "EMAIL", enabled: false },
      ],
      pushOptIn: false,
    });

    expect(delivery.inApp).toBe(true);
  });

  it("sends no email for a category that has no email to send", () => {
    // Even with the row switched on. Nothing emails a task update, so a
    // stored row saying otherwise decides nothing.
    expect(
      resolveNotificationDelivery({
        category: "TASK_UPDATE",
        preferences: [
          { category: "TASK_UPDATE", channel: "EMAIL", enabled: true },
        ],
        pushOptIn: false,
      }).email,
    ).toBe(false);
  });
});

describe("resolveNotificationMatrix email column", () => {
  it("offers an email cell only where an email is sent", () => {
    const emailCells = resolveNotificationMatrix([]).filter(
      (cell) => cell.channel === "EMAIL",
    );

    expect(emailCells.map((cell) => cell.category)).toEqual([
      ...NOTIFICATION_EMAIL_CATEGORIES,
    ]);
  });

  it("offers that cell switched on, so reminders reach an inbox by default", () => {
    const emailCells = resolveNotificationMatrix([]).filter(
      (cell) => cell.channel === "EMAIL",
    );

    expect(emailCells.every((cell) => cell.enabled)).toBe(true);
    expect(emailCells.length).toBeGreaterThan(0);
  });
});

describe("resolveNotificationMatrix", () => {
  it("answers for every cell, so the reader sees a complete matrix", () => {
    const matrix = resolveNotificationMatrix([]);

    // Two channels for every category, and the email channel only for the
    // categories that send email. Written as the sum rather than as a number,
    // so a category or an email category added later moves it on its own.
    expect(matrix).toHaveLength(
      NOTIFICATION_CATEGORIES.length * 2 + NOTIFICATION_EMAIL_CATEGORIES.length,
    );
    expect(
      matrix
        .filter(
          (cell) =>
            cell.channel === "IN_APP" && cell.category !== "CHAT_ROOM_MESSAGE",
        )
        .every((cell) => cell.enabled),
    ).toBe(true);
    expect(matrix).toContainEqual({
      category: "CHAT_MENTION",
      channel: "IN_APP",
      enabled: true,
    });
  });

  /**
   * The device is the half a reader asks for, one group at a time. An account
   * that stored nothing reads as the quiet situation on every group of the
   * settings page, rather than as a banner per row waiting on one press of
   * push consent.
   */
  it("leaves every row off the device until the reader asks", () => {
    expect(
      resolveNotificationMatrix([]).filter(
        (cell) => cell.channel === "OS_BANNER" && cell.enabled,
      ),
    ).toEqual([]);
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
      { category: "TASK_ATTENTION", channel: "IN_APP", enabled: false },
    ]);

    expect(matrix).toContainEqual({
      category: "TASK_ATTENTION",
      channel: "IN_APP",
      enabled: false,
    });
    expect(matrix).toContainEqual({
      category: "TASK_ATTENTION",
      channel: "OS_BANNER",
      enabled: false,
    });
  });

  /**
   * A row written by an older build, for a category or channel this one no
   * longer has. It belongs to no cell, so it cannot appear as one. The job row
   * is the case that actually happened: SOK-930 retired the three `JOB_*`
   * categories and left every reader's stored rows behind.
   */
  it("drops a stored row that names nothing this build knows", () => {
    const matrix = resolveNotificationMatrix([
      { category: "PIGEON", channel: "IN_APP", enabled: false },
      { category: "JOB_ATTENTION", channel: "IN_APP", enabled: false },
      { category: "TASK_ATTENTION", channel: "CARRIER_PIGEON", enabled: false },
    ]);

    // The three names, held as strings so the comparison compiles: the cells
    // are typed on the lists this build knows, and `===` against a name that
    // left one of them is a type error rather than a check.
    //
    // The length below cannot stand in for this. The matrix is built by
    // walking the category list, so a stored row this build does not know
    // cannot change how long it is, whether or not it is dropped.
    const retired = new Set<string>([
      "PIGEON",
      "JOB_ATTENTION",
      "CARRIER_PIGEON",
    ]);

    expect(
      matrix.filter(
        (cell) => retired.has(cell.category) || retired.has(cell.channel),
      ),
    ).toEqual([]);
    // Two channels for every category, and the email channel only for the
    // categories that send email. Written as the sum rather than as a number,
    // so a category or an email category added later moves it on its own.
    expect(matrix).toHaveLength(
      NOTIFICATION_CATEGORIES.length * 2 + NOTIFICATION_EMAIL_CATEGORIES.length,
    );
    expect(
      matrix
        .filter(
          (cell) =>
            cell.channel === "IN_APP" && cell.category !== "CHAT_ROOM_MESSAGE",
        )
        .every((cell) => cell.enabled),
    ).toBe(true);
  });
});
