import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TASK_ATTENTION_MESSAGE_KEYS } from "@/helpers/notification-delivery";
import { notificationFeedWhere } from "@/helpers/notification-feed";

import {
  markNotificationsRead,
  markSettledAttentionRead,
} from "./notification-read";

const { captureExceptionMock, notificationUpdateManyAndReturnMock } =
  vi.hoisted(() => ({
    captureExceptionMock: vi.fn(),
    notificationUpdateManyAndReturnMock: vi.fn(),
  }));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    notification: {
      updateManyAndReturn: notificationUpdateManyAndReturnMock,
    },
  },
}));

const { cancelNotificationEmailsMock } = vi.hoisted(() => ({
  cancelNotificationEmailsMock: vi.fn(),
}));

vi.mock("@/helpers/notification-email-dispatch", () => ({
  EMAILED_NOTIFICATION_COLUMNS: {
    id: true,
    emailId: true,
    emailScheduledAt: true,
  },
  cancelNotificationEmails: (...args: unknown[]) =>
    cancelNotificationEmailsMock(...args),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => promise,
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
      select: {
        id: true,
        emailId: true,
        emailScheduledAt: true,
        kind: true,
        messageKey: true,
      },
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

  it("hands every cleared row to the email cancel, whatever its kind", async () => {
    const scheduledAt = new Date("2026-09-19T10:10:00.000Z");
    const cleared = [
      {
        id: "notif_task",
        kind: NotificationKind.TASK,
        messageKey: "Notifications.Task.inputRequired",
        emailId: "email_task",
        emailScheduledAt: scheduledAt,
      },
      {
        id: "notif_mention",
        kind: NotificationKind.CHAT,
        messageKey: CHAT_MENTION_MESSAGE_KEY,
        emailId: null,
        emailScheduledAt: null,
      },
    ];
    notificationUpdateManyAndReturnMock.mockResolvedValue(cleared);

    await markNotificationsRead("user_123");

    expect(cancelNotificationEmailsMock).toHaveBeenCalledWith(cleared);
  });
});

describe("markSettledAttentionRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationUpdateManyAndReturnMock.mockResolvedValue([]);
  });

  /**
   * SOK-916 user stories 14 and 15. A task nobody was waiting on any more left
   * its attention row unread, and the follow-up sync would have reminded the
   * reader a day later to answer a question that had stopped being asked.
   *
   * Every attention key except the operator-removed schedule. That row asks
   * the owner to put a schedule back, which a run completing, failing or
   * being canceled answers not at all, and the schedule is still gone
   * afterwards.
   */
  it.each([
    "Notifications.Task.completed",
    "Notifications.Task.failed",
    "Notifications.Task.canceled",
  ])("clears a task's attention rows when it settles as %s", async (key) => {
    await markSettledAttentionRead(
      "user_123",
      NotificationKind.TASK,
      "task_123",
      key,
    );

    expect(notificationUpdateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user_123",
          kind: NotificationKind.TASK,
          referenceId: "task_123",
          isRead: false,
          messageKey: {
            in: TASK_ATTENTION_MESSAGE_KEYS.filter(
              (attentionKey) =>
                attentionKey !== "Notifications.Task.scheduleRemovedByOperator",
            ),
          },
        }),
      }),
    );
  });

  /**
   * Story 16, the job half. A job settles nothing here since SOK-930: no job notification is written,
   * so no job attention row is left to clear.
   */
  it.each(["Notifications.Job.completed", "Notifications.Job.failed"])(
    "writes nothing when a job settles as %s",
    async (key) => {
      const count = await markSettledAttentionRead(
        "user_123",
        NotificationKind.JOB,
        "job_123",
        key,
      );

      expect(count).toBe(0);
      expect(notificationUpdateManyAndReturnMock).not.toHaveBeenCalled();
    },
  );

  /**
   * The half that matters most. A key that is not terminal must write nothing:
   * clearing on a key that still waits on the reader would silence the very
   * row the reminder exists for.
   *
   * The attention keys are in here on purpose. They are the ones a wrong map
   * would most plausibly pick up, and the ones it would cost most.
   */
  it.each([
    ...TASK_ATTENTION_MESSAGE_KEYS,
    "Notifications.Task.somethingAddedLater",
  ])("writes nothing for %s, which does not settle anything", async (key) => {
    const count = await markSettledAttentionRead(
      "user_123",
      NotificationKind.TASK,
      "task_123",
      key,
    );

    expect(count).toBe(0);
    expect(notificationUpdateManyAndReturnMock).not.toHaveBeenCalled();
  });

  /**
   * The feed rule stays out of this write on purpose. A reader with In app
   * off and Email on has an email waiting on a row the feed would never show,
   * and that email is their only delivery. Leaving it to arrive asks them to
   * answer a question that has stopped being asked, which is the outcome this
   * function exists to prevent.
   */
  it("clears a row the feed would never show, and takes its email back", async () => {
    const hidden = {
      id: "notif_hidden",
      emailId: "email_hidden",
      emailScheduledAt: new Date("2026-09-19T10:10:00.000Z"),
    };
    notificationUpdateManyAndReturnMock.mockResolvedValue([hidden]);

    const count = await markSettledAttentionRead(
      "user_123",
      NotificationKind.TASK,
      "task_123",
      "Notifications.Task.canceled",
    );

    expect(count).toBe(1);
    const where = notificationUpdateManyAndReturnMock.mock.calls[0]?.[0].where;
    expect(where).not.toHaveProperty("inApp");
    expect(where).not.toHaveProperty("OR");
    expect(cancelNotificationEmailsMock).toHaveBeenCalledWith([hidden]);
  });

  it("reports a failed write and does not throw at the caller", async () => {
    notificationUpdateManyAndReturnMock.mockRejectedValue(
      new Error("write failed"),
    );

    const count = await markSettledAttentionRead(
      "user_123",
      NotificationKind.TASK,
      "task_123",
      "Notifications.Task.canceled",
    );

    // Both dispatchers write the outcome notification next to this call. A
    // throw here would cost the reader that notification as well.
    expect(count).toBe(0);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          notificationType: "settled-attention-read",
          referenceId: "task_123",
        }),
      }),
    );
  });
});
