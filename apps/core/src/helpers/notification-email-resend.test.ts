import * as nodeTimers from "node:timers";
import { type Notification, NotificationKind } from "@sokosumi/database";
import {
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "@sokosumi/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resendRoomMessageEmail } from "./notification-email-resend";

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
  transactionState,
  storedNotifications,
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
  transactionState: {
    open: false,
    sendEmailWhileOpen: false,
  },
  storedNotifications: new Map<string, Notification>(),
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
      findUnique: async (query: { where: { id: string } }) => {
        const read = await notificationFindUniqueMock(query);
        if (read === null) return null;
        const stored = storedNotifications.get(query.where.id);
        return stored ? { ...stored, ...read } : read;
      },
      findMany: notificationFindManyMock,
      updateMany: async (query: {
        where: { id: string };
        data: Partial<Notification>;
      }) => {
        const result = await notificationUpdateManyMock(query);
        const stored = storedNotifications.get(query.where.id);
        if (result.count > 0 && stored) Object.assign(stored, query.data);
        return result;
      },
    },
    user: { findUnique: userFindUniqueMock },
    chatRoomMessage: { findFirst: async () => ({ id: "message_1" }) },
    $queryRaw: async () => [],
  };
  return {
    default: {
      ...client,
      $transaction: async (fn: (tx: typeof client) => unknown) => {
        const started = Date.now();
        transactionState.open = true;
        try {
          const result = await fn(client);
          const elapsed = Date.now() - started;
          if (elapsed > 5_000) {
            throw Object.assign(
              new Error(
                `Transaction API error: A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however ${elapsed} ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.`,
              ),
              { name: "PrismaClientKnownRequestError" },
            );
          }
          await transactionCommitMock();
          return result;
        } finally {
          transactionState.open = false;
        }
      },
    },
  };
});

beforeEach(() => storedNotifications.clear());

const NOW = new Date("2026-09-19T10:00:00.000Z");
const TEN_MINUTES_LATER = new Date("2026-09-19T10:10:00.000Z");

/**
 * A real event-loop turn. Copied at load, before `useFakeTimers` replaces
 * `node:timers`. Sentry 11.1 keeps that original and schedules work on it.
 */
const nativeSetTimeout = nodeTimers.setTimeout.bind(nodeTimers);

function nativeTick(): Promise<void> {
  return new Promise((resolve) => {
    nativeSetTimeout(resolve, 0);
  });
}

function restoreTimers() {
  if (vi.getTimerCount() > 0) {
    vi.runOnlyPendingTimers();
  }
  vi.useRealTimers();
}

/**
 * Drive a dispatch/resend/cancel to the end under fake timers.
 *
 * `runAllTimersAsync` waits on the test promise while Sentry 11.1's captured
 * turn has not run, so it deadlocks. Pump a native 0-ms tick so that turn
 * can queue the fake `sleep`, then run only fake timers that are already
 * queued. The 500ms Resend gap stays a fake timer.
 */
async function flush(task: Promise<unknown>): Promise<void> {
  let settled = false;
  const tracked = Promise.resolve(task).finally(() => {
    settled = true;
  });

  for (let i = 0; i < 10_000; i += 1) {
    if (settled) {
      await tracked;
      if (vi.getTimerCount() > 0) {
        vi.runOnlyPendingTimers();
      }
      return;
    }
    if (vi.getTimerCount() > 0) {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
      continue;
    }
    await Promise.resolve();
    if (!settled) {
      await nativeTick();
    }
  }

  throw new Error("flush: task never settled");
}

function mention(overrides: Partial<Notification> = {}): Notification {
  const notification: Notification = {
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
  storedNotifications.set(notification.id, notification);
  return notification;
}

/** A room row whose email is already scheduled, standing for `count` messages. */
function scheduledRoomRow(
  count: number,
  overrides: Partial<Notification> = {},
) {
  return mention({
    messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY,
    messageParams: JSON.stringify({
      authorName: "Ada",
      count,
      messagePreview: "Can you check this?",
      roomName: "Design",
    }),
    emailId: "email_stale",
    emailScheduledAt: TEN_MINUTES_LATER,
    ...overrides,
  });
}

/** Run the resend to the end, through every wait it schedules. */
async function resend(): Promise<void> {
  await flush(resendRoomMessageEmail("notification_1"));
}

describe("resendRoomMessageEmail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    notificationFindManyMock.mockResolvedValue([]);
    notificationUpdateManyMock.mockResolvedValue({ count: 1 });
    userFindUniqueMock.mockResolvedValue({
      email: "reader@example.com",
      name: "Grace",
    });
    hasAppInFrontMock.mockResolvedValue(false);
    sendEmailMock.mockResolvedValue({ id: "email_2" });
    cancelEmailMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    restoreTimers();
  });

  /**
   * The row now stands for three messages rather than two, so the email says
   * three. The send time it was promised is kept: deciding a fresh delay on
   * every message would push a busy room's email away for as long as anyone
   * kept writing (SOK-1142).
   */
  it("sends the new tally at the time the old email was promised", async () => {
    // Three minutes into the wait, so a fresh delay would be a different
    // instant and the assertion below can tell the two apart.
    vi.setSystemTime(new Date("2026-09-19T10:03:00.000Z"));
    notificationFindUniqueMock
      .mockResolvedValueOnce(scheduledRoomRow(3))
      .mockResolvedValueOnce({ isRead: false })
      .mockResolvedValueOnce({ isRead: false })
      .mockResolvedValueOnce({ isRead: false });

    await resend();

    expect(sendEmailMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        subject: "Sokosumi - 3 unread messages in Design",
        scheduledAt: TEN_MINUTES_LATER.toISOString(),
        idempotencyKey: expect.stringMatching(
          /^notification-email\/notification_1\/3\/[a-f0-9]{64}$/,
        ),
      }),
    );
  });

  /**
   * The new email is handed over first. A cancel that runs before a send that
   * fails would leave the reader with no email at all, which is the more
   * expensive failure than one duplicate. The write of the new id is what
   * takes the old email back.
   */
  it("takes the old email back only once the new one is away", async () => {
    notificationFindUniqueMock
      .mockResolvedValueOnce(scheduledRoomRow(3))
      .mockResolvedValueOnce({ isRead: false })
      .mockResolvedValueOnce({ isRead: false })
      .mockResolvedValueOnce({ isRead: false });

    await resend();

    expect(cancelEmailMock).toHaveBeenCalledExactlyOnceWith("email_stale");
    expect(sendEmailMock.mock.invocationCallOrder[0]).toBeLessThan(
      cancelEmailMock.mock.invocationCallOrder[0] as number,
    );
  });

  /**
   * The dispatch sent nothing, so the old email is the reader's only one and
   * cancelling it here would take it away.
   */
  it("keeps the old email when nothing replaced it", async () => {
    notificationFindUniqueMock
      .mockResolvedValueOnce(scheduledRoomRow(3))
      .mockResolvedValueOnce({ isRead: true });

    await resend();

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(cancelEmailMock).not.toHaveBeenCalled();
  });

  /** Nothing left to say differently: that email is already on its way. */
  it("does nothing once the email has left", async () => {
    notificationFindUniqueMock.mockResolvedValueOnce(
      scheduledRoomRow(3, { emailScheduledAt: null }),
    );

    await resend();

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(cancelEmailMock).not.toHaveBeenCalled();
  });

  it("does nothing for a row the reader has already read", async () => {
    notificationFindUniqueMock.mockResolvedValueOnce(
      scheduledRoomRow(3, { isRead: true }),
    );

    await resend();

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(cancelEmailMock).not.toHaveBeenCalled();
  });
});
