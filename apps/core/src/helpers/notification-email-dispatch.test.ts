import { type Notification, NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  TASK_INPUT_REQUIRED_MESSAGE_KEY,
} from "@sokosumi/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TASK_COMPLETED_MESSAGE_KEY,
  TASK_SCHEDULE_REMOVED_MESSAGE_KEY,
} from "./notification-delivery";
import {
  cancelNotificationEmails,
  dispatchNotificationEmail,
} from "./notification-email-dispatch";

const {
  transactionCommitMock,
  lockCalendarWorkspaceMembershipMock,
  hasCalendarWorkspaceAccessMock,
  captureExceptionMock,
  captureMessageMock,
  sendEmailMock,
  cancelEmailMock,
  hasAppInFrontMock,
  notificationFindUniqueMock,
  notificationFindManyMock,
  notificationUpdateManyMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  transactionCommitMock: vi.fn(),
  lockCalendarWorkspaceMembershipMock: vi.fn(),
  hasCalendarWorkspaceAccessMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  captureMessageMock: vi.fn(),
  sendEmailMock: vi.fn(),
  cancelEmailMock: vi.fn(),
  hasAppInFrontMock: vi.fn(),
  notificationFindUniqueMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  notificationUpdateManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/calendar-membership-fence", () => ({
  hasCalendarWorkspaceAccess: hasCalendarWorkspaceAccessMock,
  lockCalendarWorkspaceMembership: lockCalendarWorkspaceMembershipMock,
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

vi.mock("@/clients/email.client", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  cancelEmail: (...args: unknown[]) => cancelEmailMock(...args),
}));

vi.mock("@/lib/ably/channel-occupancy", () => ({
  hasAppInFront: (...args: unknown[]) => hasAppInFrontMock(...args),
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    notification: {
      findUnique: notificationFindUniqueMock,
      findMany: notificationFindManyMock,
      updateMany: notificationUpdateManyMock,
    },
    user: { findUnique: userFindUniqueMock },
  };
  return {
    default: {
      ...client,
      $transaction: async (fn: (tx: typeof client) => unknown) => {
        const result = await fn(client);
        await transactionCommitMock();
        return result;
      },
    },
  };
});

const NOW = new Date("2026-09-19T10:00:00.000Z");
const TEN_MINUTES_LATER = new Date("2026-09-19T10:10:00.000Z");

function mention(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notification_1",
    userId: "user_1",
    workspaceId: null,
    organizationId: null,
    kind: NotificationKind.CHAT,
    referenceId: "room_1",
    eventId: "message_1",
    messageKey: CHAT_MENTION_MESSAGE_KEY,
    messageParams: JSON.stringify({
      authorName: "Ada",
      messagePreview: "Can you check this?",
      roomName: "Design",
    }),
    metadata: JSON.stringify({ messageId: "message_1" }),
    isRead: false,
    readAt: null,
    createdAt: NOW,
    inApp: true,
    emailId: null,
    emailScheduledAt: null,
    publishId: null,
    publishPush: null,
    publishCreated: null,
    publishQueuedAt: null,
    publishNextAttemptAt: null,
    ...overrides,
  };
}

/** A finished task, for the reader who started it. */
function finished(overrides: Partial<Notification> = {}): Notification {
  return mention({
    id: "notification_2",
    kind: NotificationKind.TASK,
    referenceId: "task_1",
    eventId: "task_event_1",
    messageKey: TASK_COMPLETED_MESSAGE_KEY,
    messageParams: JSON.stringify({
      coworkerName: "Atlas",
      projectName: "Launch",
      taskName: "Pricing review",
    }),
    metadata: null,
    ...overrides,
  });
}

/** Run the dispatch to the end, through every wait it schedules. */
async function dispatch(notification: Notification): Promise<void> {
  const run = dispatchNotificationEmail(notification);
  await vi.runAllTimersAsync();
  await run;
}

describe("dispatchNotificationEmail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    hasCalendarWorkspaceAccessMock.mockResolvedValue(true);
    lockCalendarWorkspaceMembershipMock.mockResolvedValue(undefined);
    transactionCommitMock.mockResolvedValue(undefined);
    notificationFindUniqueMock.mockResolvedValue({ isRead: false });
    notificationFindManyMock.mockResolvedValue([]);
    notificationUpdateManyMock.mockResolvedValue({ count: 1 });
    userFindUniqueMock.mockResolvedValue({
      email: "reader@example.com",
      name: "Grace",
    });
    hasAppInFrontMock.mockResolvedValue(false);
    sendEmailMock.mockResolvedValue({ id: "email_1" });
    cancelEmailMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emails successful closure even when the failure email remains unread", async () => {
    notificationFindManyMock.mockResolvedValue([
      { messageKey: "Notifications.Project.closeFailed" },
    ]);
    await dispatch(
      mention({
        kind: NotificationKind.PROJECT,
        referenceId: "project_1",
        messageKey: "Notifications.Project.closed",
        messageParams: JSON.stringify({ projectName: "Launch" }),
      }),
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Sokosumi - Launch is now closed" }),
    );
  });

  it("skips calendar emails after workspace access is revoked", async () => {
    hasCalendarWorkspaceAccessMock.mockResolvedValue(false);
    await dispatch(
      finished({
        workspaceId: "workspace_1",
        messageKey: "Notifications.Task.scheduleUpdatedByMember",
      }),
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(hasCalendarWorkspaceAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      "workspace_1",
      "user_1",
    );
  });

  it("delays calendar email while the app is in front", async () => {
    hasAppInFrontMock.mockResolvedValue(true);
    await dispatch(
      finished({
        workspaceId: "workspace_1",
        messageKey: "Notifications.Task.scheduleUpdatedByMember",
      }),
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: "2026-09-19T10:30:00.000Z" }),
    );
    expect(lockCalendarWorkspaceMembershipMock).toHaveBeenCalledWith(
      expect.anything(),
      "workspace_1",
    );
  });

  it("cancels an accepted scheduled email if its transaction cannot commit", async () => {
    hasAppInFrontMock.mockResolvedValue(true);
    transactionCommitMock.mockRejectedValueOnce(new Error("commit failed"));
    await dispatch(
      finished({
        workspaceId: "workspace_1",
        messageKey: "Notifications.Task.scheduleUpdatedByMember",
      }),
    );
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(cancelEmailMock).toHaveBeenCalledWith("email_1");
  });

  it("sends the email now when the reader has nothing in front of them", async () => {
    await dispatch(mention());

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "reader@example.com",
        subject: "Sokosumi - Ada mentioned you in Design",
        tag: "notification",
        idempotencyKey: "notification-email/notification_1",
      }),
    );
    expect(sendEmailMock.mock.calls[0]?.[0]).not.toHaveProperty("scheduledAt");
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "notification_1", isRead: false },
      data: { emailId: "email_1", emailScheduledAt: null },
    });
    expect(cancelEmailMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("hands Resend a send time the category's delay out when the app is in front", async () => {
    hasAppInFrontMock.mockResolvedValue(true);

    await dispatch(mention());

    expect(hasAppInFrontMock).toHaveBeenCalledWith("user_1");
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledAt: TEN_MINUTES_LATER.toISOString(),
      }),
    );
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "notification_1", isRead: false },
      data: { emailId: "email_1", emailScheduledAt: TEN_MINUTES_LATER },
    });
    // The write took the row, so the email waits. Cancelling it here would
    // take back every delayed email the moment it was scheduled, and the
    // reader who is looking at the app would get none of them at all.
    expect(cancelEmailMock).not.toHaveBeenCalled();
  });

  it("takes the email back when the row went read while it was being handed over", async () => {
    hasAppInFrontMock.mockResolvedValue(true);
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });

    await dispatch(mention());

    expect(cancelEmailMock).toHaveBeenCalledWith("email_1");
  });

  it("takes a room message's email back the same way when its row went read", async () => {
    hasAppInFrontMock.mockResolvedValue(true);
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });

    await dispatch(mention({ messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY }));

    expect(cancelEmailMock).toHaveBeenCalledWith("email_1");
  });

  it("takes a task update's email back the same way when its row went read", async () => {
    hasAppInFrontMock.mockResolvedValue(true);
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });

    await dispatch(finished({ messageKey: "Notifications.Task.canceled" }));

    expect(cancelEmailMock).toHaveBeenCalledWith("email_1");
  });

  it("leaves an email that already left alone when the row went read", async () => {
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });

    await dispatch(mention());

    expect(cancelEmailMock).not.toHaveBeenCalled();
  });

  it("does nothing for a follow-up, whose sync mails it", async () => {
    await dispatch(mention({ messageKey: CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY }));

    expect(notificationFindUniqueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does nothing for a category that is not emailed at the event", async () => {
    // Billing news is the lasting example: Stripe already mails it.
    await dispatch(
      mention({
        kind: NotificationKind.BILLING,
        referenceId: "wallet_1",
        messageKey: "Notifications.Billing.creditsAdded",
        messageParams: JSON.stringify({ credits: 10 }),
      }),
    );

    expect(notificationFindUniqueMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("waits for the row to commit before it does anything", async () => {
    notificationFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ isRead: false });

    await dispatch(mention());

    // Two reads that found nothing, the one that found the row, then the
    // one at this row's turn in the queue.
    expect(notificationFindUniqueMock).toHaveBeenCalledTimes(4);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The queue holds an email half a second for every row ahead of it, so a
   * room of thirty spans fifteen seconds. The reader can read the
   * notification inside that, and the email would then ask them to look at
   * something they have already seen.
   */
  it("sends nothing for a row that went read while it waited its turn", async () => {
    notificationFindUniqueMock
      .mockResolvedValueOnce({ isRead: false })
      .mockResolvedValueOnce({ isRead: true });

    await dispatch(mention());

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  /**
   * A request resolved while the email waited takes its rows with it. The
   * other approvers would otherwise be asked to review something that was
   * already granted or denied.
   */
  it("sends nothing for a row that was taken away while it waited its turn", async () => {
    notificationFindUniqueMock
      .mockResolvedValueOnce({ isRead: false })
      .mockResolvedValueOnce(null);

    await dispatch(mention());

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  /**
   * A rolled-back transaction, or one slower than the wait. The first is
   * nothing to report and the second is, and this cannot tell them apart, so
   * it says so as a warning rather than an error.
   */
  it("gives up on a row that never appears, and says so", async () => {
    notificationFindUniqueMock.mockResolvedValue(null);

    await dispatch(mention());

    expect(notificationFindUniqueMock).toHaveBeenCalledTimes(5);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Notification row never committed; email skipped",
      expect.objectContaining({
        level: "warning",
        extra: expect.objectContaining({ notificationId: "notification_1" }),
      }),
    );
  });

  it("sends nothing for a row the reader has already read", async () => {
    notificationFindUniqueMock.mockResolvedValue({ isRead: true });

    await dispatch(mention());

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  /**
   * A direct message and then a mention in the same room is one email: the
   * room is read as a whole. Only rows the reader can see in Sokosumi are
   * asked, because only those go read there.
   */
  it("sends nothing when an unread row about the same thing was already mailed", async () => {
    notificationFindManyMock.mockResolvedValue([
      { messageKey: CHAT_DIRECT_MESSAGE_MESSAGE_KEY },
    ]);

    await dispatch(mention());

    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        kind: NotificationKind.CHAT,
        referenceId: "room_1",
        isRead: false,
        emailId: { not: null },
        id: { not: "notification_1" },
      },
      select: { messageKey: true },
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  /**
   * A task row written with In app off is in no list the reader can open,
   * so it is not asked. That reader is mailed per event rather than per
   * unread thing. A chat row is asked whether hidden or not, because
   * opening the room reads every row of the room.
   */
  it("asks only the rows the reader can read, which for a task means the visible ones", async () => {
    await dispatch(finished());

    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: NotificationKind.TASK,
          referenceId: "task_1",
          inApp: true,
        }),
      }),
    );
  });

  /**
   * Two questions from one task are one email. The reader answers both in
   * the same place, so the second would say nothing the first did not.
   */
  it("sends nothing for a second question about a task whose first was mailed", async () => {
    notificationFindManyMock.mockResolvedValue([
      { messageKey: TASK_INPUT_REQUIRED_MESSAGE_KEY },
    ]);

    await dispatch(
      finished({ messageKey: "Notifications.Task.approvalRequired" }),
    );

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  /**
   * The question a task asked and the finish it reports are two emails the
   * reader turned on separately. A "schedule removed" row is the one no run
   * ends, so without this it would hold every finish of the task out of the
   * inbox until the reader happened to open that row.
   */
  it("mails a task's finish although its unanswered question was mailed", async () => {
    notificationFindManyMock.mockResolvedValue([
      { messageKey: TASK_SCHEDULE_REMOVED_MESSAGE_KEY },
    ]);

    await dispatch(finished());

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Sokosumi - Atlas completed Pricing review",
      }),
    );
  });

  /**
   * Everything a room can say is one email. Whichever row mails first speaks
   * for the room, and the reader reads the room as a whole, so the other rows
   * hold back until it is read (SOK-1142).
   */
  it("sends nothing for a room message whose room was already mailed, nor after one", async () => {
    notificationFindManyMock.mockResolvedValue([
      { messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY },
    ]);

    await dispatch(mention());

    expect(sendEmailMock).not.toHaveBeenCalled();

    notificationFindManyMock.mockResolvedValue([
      { messageKey: CHAT_MENTION_MESSAGE_KEY },
    ]);

    await dispatch(
      mention({
        id: "notification_9",
        messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY,
      }),
    );

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("mails a room message on its own when nothing was mailed", async () => {
    await dispatch(mention({ messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY }));

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Sokosumi - Unread messages in Design",
      }),
    );
  });

  /**
   * The change and the question are two emails the reader turned on
   * separately, like the finish and the question before them.
   */
  it("mails a task update although the task's unanswered question was mailed", async () => {
    notificationFindManyMock.mockResolvedValue([
      { messageKey: TASK_INPUT_REQUIRED_MESSAGE_KEY },
    ]);

    await dispatch(finished({ messageKey: "Notifications.Task.canceled" }));

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Sokosumi - Pricing review was canceled",
      }),
    );
  });

  /**
   * Two mentions of one reader that arrive together. The check for an
   * earlier email is asked inside the queue, after the sender before it has
   * written its id, so the second sees the first rather than both passing
   * the check before either has sent.
   */
  it("asks about an earlier email only once the send before it has written", async () => {
    notificationFindManyMock.mockImplementation(async () =>
      notificationUpdateManyMock.mock.calls.length > 0
        ? [{ messageKey: CHAT_MENTION_MESSAGE_KEY }]
        : [],
    );

    const first = dispatchNotificationEmail(mention({ id: "n1" }));
    const second = dispatchNotificationEmail(
      mention({ id: "n2", eventId: "message_2" }),
    );
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing to a reader who is gone", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    await dispatch(mention());

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a key inside an emailing category with no template", async () => {
    await dispatch(
      mention({
        kind: NotificationKind.SYSTEM,
        messageKey: "notifications.system.other",
      }),
    );

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("sends now, and says so, when Ably cannot say whether the app is in front", async () => {
    hasAppInFrontMock.mockRejectedValue(new Error("no channel-metadata"));

    await dispatch(mention());

    expect(sendEmailMock.mock.calls[0]?.[0]).not.toHaveProperty("scheduledAt");
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          notificationType: "notification-email-occupancy",
        }),
      }),
    );
  });

  it("reports a refused send and leaves the row without an email", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("rate_limit_exceeded"));

    await dispatch(mention());

    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          notificationId: "notification_1",
          notificationType: "notification-email",
        }),
      }),
    );

    // The queue outlives the refusal: the next send still goes.
    await dispatch(mention({ id: "n2", userId: "user_2" }));

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a row whose columns will not read", async () => {
    await dispatch(mention({ messageParams: "{not json" }));
    await dispatch(mention({ id: "n2", metadata: "{not json" }));

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("keeps a room mention's readers half a second apart for Resend", async () => {
    const first = dispatchNotificationEmail(mention({ id: "n1" }));
    const second = dispatchNotificationEmail(
      mention({ id: "n2", userId: "user_2" }),
    );

    // Everything before the send is immediate; the second send waits its turn.
    await vi.advanceTimersByTimeAsync(0);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);

    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
  });
});

describe("cancelNotificationEmails", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    hasCalendarWorkspaceAccessMock.mockResolvedValue(true);
    lockCalendarWorkspaceMembershipMock.mockResolvedValue(undefined);
    transactionCommitMock.mockResolvedValue(undefined);
    notificationUpdateManyMock.mockResolvedValue({ count: 1 });
    cancelEmailMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function cancel(
    rows: Parameters<typeof cancelNotificationEmails>[0],
  ): Promise<void> {
    const run = cancelNotificationEmails(rows);
    await vi.runAllTimersAsync();
    await run;
  }

  it("cancels only the emails still waiting to leave, and clears them off the row", async () => {
    await cancel([
      {
        id: "n_future",
        emailId: "e_future",
        emailScheduledAt: TEN_MINUTES_LATER,
      },
      { id: "n_sent", emailId: "e_sent", emailScheduledAt: null },
      {
        id: "n_left",
        emailId: "e_left",
        emailScheduledAt: new Date("2026-09-19T09:59:59.000Z"),
      },
      { id: "n_none", emailId: null, emailScheduledAt: null },
    ]);

    expect(cancelEmailMock).toHaveBeenCalledTimes(1);
    expect(cancelEmailMock).toHaveBeenCalledWith("e_future");
    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "n_future" },
      data: { emailId: null, emailScheduledAt: null },
    });
    // A row with no send time is passed over, not tripped over and swallowed.
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  /**
   * The rows wait their turn in the queue. One due during that wait has left
   * by the time its turn comes, so it is asked then and left alone, rather
   * than cancelled after the fact and reported as a refusal.
   */
  it("leaves an email alone that left while the row waited its turn", async () => {
    const run = cancelNotificationEmails([
      { id: "n1", emailId: "e1", emailScheduledAt: TEN_MINUTES_LATER },
      {
        id: "n_due",
        emailId: "e_due",
        emailScheduledAt: new Date(NOW.getTime() + 400),
      },
    ]);
    await vi.runAllTimersAsync();
    await run;

    expect(cancelEmailMock).toHaveBeenCalledTimes(1);
    expect(cancelEmailMock).toHaveBeenCalledWith("e1");
    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("reports a refusal and carries on with the next row", async () => {
    cancelEmailMock
      .mockRejectedValueOnce(new Error("already sent"))
      .mockResolvedValue(undefined);

    await cancel([
      { id: "n1", emailId: "e1", emailScheduledAt: TEN_MINUTES_LATER },
      { id: "n2", emailId: "e2", emailScheduledAt: TEN_MINUTES_LATER },
    ]);

    expect(cancelEmailMock).toHaveBeenCalledTimes(2);
    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "n2" } }),
    );
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          notificationId: "n1",
          emailId: "e1",
          notificationType: "notification-email-cancel",
        }),
      }),
    );
  });
});
