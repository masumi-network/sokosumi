import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  chatRoomMessageFindFirstMock,
  threadReadStateFindUniqueMock,
  createNotificationMock,
  notificationFindManyMock,
  resolveDeliveryMock,
  sendEmailsMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  chatRoomMessageFindFirstMock: vi.fn(),
  threadReadStateFindUniqueMock: vi.fn(),
  createNotificationMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  resolveDeliveryMock: vi.fn(),
  sendEmailsMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: { findFirst: chatRoomMessageFindFirstMock },
    chatRoomThreadReadState: { findUnique: threadReadStateFindUniqueMock },
    notification: {
      findMany: notificationFindManyMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));
vi.mock("@/clients/email.client", () => ({
  // The real size, so a test can put more than one chunk in a page and see
  // what the service does with a refusal in the middle of it.
  RESEND_BATCH_MAX_SIZE: 100,
  sendEmails: sendEmailsMock,
}));
vi.mock("@/helpers/notifications", () => ({
  createNotification: createNotificationMock,
  resolveDelivery: resolveDeliveryMock,
}));

import {
  NOTIFICATION_FOLLOW_UP_PAGE_SIZE,
  notificationFollowUpSyncService,
} from "@/services/notification-follow-up-sync.service";

const now = new Date("2026-09-15T12:00:00.000Z");

/** Inside the window: a day old, and less than two hours past the mark. */
const WAITING = new Date("2026-09-14T11:00:00.000Z");

/**
 * The event id a reminder about `reference` takes for a row seeded at
 * `WAITING`.
 *
 * Spelled out through the same two parts the source does, the reference and
 * the day the row arrived, rather than by calling the helper: a test that
 * builds its expectation with the code under test agrees with any change to
 * it, including a wrong one.
 */
function followUpId(reference: string): string {
  return `follow-up:${reference}:2026-09-14`;
}
/** Not yet a day old. */
const TOO_YOUNG = new Date("2026-09-15T06:00:00.000Z");
/** A day old before this run's window opened. */
const TOO_OLD = new Date("2026-09-14T09:00:00.000Z");
/** A day old to the millisecond: the youngest a reminder is due for. */
const JUST_A_DAY = new Date("2026-09-14T12:00:00.000Z");
/** The instant the window opens on, which the window itself excludes. */
const WINDOW_EDGE = new Date("2026-09-14T10:00:00.000Z");

interface StoredNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  referenceId: string;
  messageKey: string;
  messageParams: string;
  metadata: string | null;
  isRead: boolean;
  inApp: boolean;
  createdAt: Date;
}

interface RowOverrides {
  id?: string;
  kind?: NotificationKind;
  messageKey?: string;
  messageParams?: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  referenceId?: string;
  userId?: string;
  isRead?: boolean;
  inApp?: boolean;
  createdAt?: Date;
}

/** A stored notification as the database holds it: JSON columns as text. */
function row(overrides: RowOverrides = {}): StoredNotification {
  const {
    messageParams = { authorName: "Ada", roomName: "Design" },
    metadata = { messageId: "message-1" },
    ...rest
  } = overrides;

  return {
    id: "notification-1",
    userId: "reader-1",
    kind: NotificationKind.CHAT,
    referenceId: "room-1",
    messageKey: CHAT_MENTION_MESSAGE_KEY,
    messageParams: JSON.stringify(messageParams),
    metadata: metadata === null ? null : JSON.stringify(metadata),
    isRead: false,
    inApp: true,
    createdAt: WAITING,
    ...rest,
  };
}

/** The bounds a date range can carry, as Prisma spells them. */
type RangeClause = Partial<{ gt: Date; gte: Date; lt: Date; lte: Date }>;

/**
 * Whether one date satisfies every bound its clause carries.
 *
 * All four operators are modelled, so swapping one for its neighbour changes
 * which rows come back instead of dropping the bound. Modelling only the two
 * the service writes would make `gt` and `gte` indistinguishable here, and the
 * tests that name the window's edges would pass either way.
 */
function withinRange(value: Date, clause: RangeClause | undefined): boolean {
  if (clause === undefined) {
    return true;
  }

  const at = value.getTime();

  return (
    (clause.gt === undefined || at > clause.gt.getTime()) &&
    (clause.gte === undefined || at >= clause.gte.getTime()) &&
    (clause.lt === undefined || at < clause.lt.getTime()) &&
    (clause.lte === undefined || at <= clause.lte.getTime())
  );
}

/** One term of the service's `orderBy`, in the order it lists them. */
type OrderByClause = { createdAt: "asc" | "desc" } | { id: "asc" | "desc" };

/**
 * Two stored rows, compared by the terms the query actually asked for.
 *
 * Read off the query rather than fixed here. Sorting by `createdAt` and `id`
 * regardless would give the service an order it never asked for, and dropping
 * `id` from its `orderBy` would then break nothing.
 *
 * Rows the terms cannot separate come back in the reverse of the order they
 * were stored in. The real table promises no order at all for those, and
 * returning them in the order they were written would quietly settle the one
 * thing the query left open. Reversing is the cheapest order that is not the
 * one a test would have assumed.
 */
function compareBy(
  a: StoredNotification,
  b: StoredNotification,
  orderBy: OrderByClause[],
  stored: readonly StoredNotification[],
): number {
  for (const term of orderBy) {
    const ascending =
      "createdAt" in term ? term.createdAt === "asc" : term.id === "asc";
    const difference =
      "createdAt" in term
        ? a.createdAt.getTime() - b.createdAt.getTime()
        : compareIds(a.id, b.id);

    if (difference !== 0) {
      // The direction is read, not assumed. Reading only the field would let
      // the service ask for newest first and still be served oldest first,
      // and the paging filter, which only ever looks forward, would then walk
      // away from the rows it had not reached.
      return ascending ? difference : -difference;
    }
  }

  return stored.indexOf(b) - stored.indexOf(a);
}

/**
 * One branch of the service's "after this row" paging filter.
 *
 * `gt` is optional although the service always writes it. This type only
 * annotates the mock's own parameter, so it cannot reject a service that wrote
 * a different operator. What it can do is leave the branch with no bound,
 * which makes it match nothing and every paging test fail.
 */
type AfterClause =
  | { createdAt: Partial<{ gt: Date }> }
  | { createdAt: Date; id: Partial<{ gt: string }> };

/**
 * Two ids, in the one order this fake uses.
 *
 * Sorting and paging have to agree. A real table orders and compares under one
 * collation, so a fake that sorted by locale and paged by code unit could put
 * a row before the position it then treats as behind it, and lose it.
 */
function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

/**
 * Whether a stored row satisfies one branch of the paging filter.
 *
 * A branch whose bound is missing matches nothing. That is what an operator
 * this fake does not model has to do: every row then falls outside the page
 * and the paging tests fail, rather than the fake quietly serving the rows
 * the service would have got from the operator it no longer writes.
 */
function isAfter(one: StoredNotification, clause: AfterClause): boolean {
  if ("id" in clause) {
    return (
      one.createdAt.getTime() === clause.createdAt.getTime() &&
      clause.id.gt !== undefined &&
      compareIds(one.id, clause.id.gt) > 0
    );
  }

  return (
    clause.createdAt.gt !== undefined && one.createdAt > clause.createdAt.gt
  );
}

/**
 * The input of the first follow-up this run wrote.
 *
 * Read off the call rather than asserted through `toHaveBeenCalledWith`, so a
 * test about the input the service builds says only that. Matching the whole
 * call would pin the argument list too, and fail on an argument it is not
 * about.
 */
function firstFollowUpInput() {
  return createNotificationMock.mock.calls[0]?.[0];
}

/** Every follow-up the run wrote, in the order it wrote them. */
let written: {
  eventId: string;
  kind: string;
  messageKey: string;
  referenceId: string;
  userId: string;
}[] = [];

/**
 * The notification table, in memory.
 *
 * Filters rather than replays, so a test says what is stored and asserts what
 * the reader ends up with. Asserting the shape of the query instead would pass
 * for a service that asked the right question and then ignored the answer.
 *
 * The write that goes with this is `createNotificationMock` in `beforeEach`.
 * It refuses a second row for a tuple it already holds, which is what the
 * table's own `@@unique([userId, kind, referenceId, eventId, messageKey])`
 * does. That constraint is the whole of this feature's idempotency, so a fake
 * without it would leave the one property most worth proving untested.
 */
function seed(stored: readonly StoredNotification[]) {
  notificationFindManyMock.mockImplementation(
    async (query: {
      where: Partial<{
        createdAt: RangeClause;
        inApp: boolean;
        isRead: boolean;
        messageKey: { in: string[] };
        OR: AfterClause[];
      }>;
      orderBy?: OrderByClause[];
      take?: number;
    }) => {
      const { where } = query;

      // Every clause is optional here so that dropping one from the service
      // narrows nothing, the way it would against the real table. Required,
      // a dropped clause would read as `undefined` and match no row, and the
      // whole file would fail rather than the one test that is about it.
      //
      // The paging clause is applied as a filter, exactly as the service
      // writes it. A service that paged without one would read the same page
      // forever, which this reproduces rather than quietly moving on.
      return stored
        .filter(
          (one) =>
            (where.isRead === undefined || one.isRead === where.isRead) &&
            (where.inApp === undefined || one.inApp === where.inApp) &&
            (where.messageKey === undefined ||
              where.messageKey.in.includes(one.messageKey)) &&
            withinRange(one.createdAt, where.createdAt) &&
            (where.OR === undefined ||
              where.OR.some((clause) => isAfter(one, clause))),
        )
        .sort((a, b) => compareBy(a, b, query.orderBy ?? [], stored))
        .slice(0, query.take ?? stored.length);
    },
  );
}

describe("NotificationFollowUpSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    written = [];
    chatRoomMessageFindFirstMock.mockResolvedValue({
      id: "message-1",
      parentMessageId: null,
    });
    threadReadStateFindUniqueMock.mockResolvedValue(null);
    seed([]);
    resolveDeliveryMock.mockResolvedValue({
      inApp: true,
      osBanner: false,
      email: false,
    });
    userFindUniqueMock.mockResolvedValue({
      email: "reader@example.com",
      name: "Sandro",
    });
    sendEmailsMock.mockResolvedValue([]);
    createNotificationMock.mockImplementation(
      async (input: {
        eventId: string;
        kind: string;
        messageKey: string;
        referenceId: string;
        userId: string;
      }) => {
        const taken = written.some(
          (one) =>
            one.eventId === input.eventId &&
            one.kind === input.kind &&
            one.messageKey === input.messageKey &&
            one.referenceId === input.referenceId &&
            one.userId === input.userId,
        );

        if (taken) {
          return { notification: { id: input.eventId }, created: false };
        }

        written.push({
          eventId: input.eventId,
          kind: input.kind,
          messageKey: input.messageKey,
          referenceId: input.referenceId,
          userId: input.userId,
        });

        return { notification: { id: input.eventId }, created: true };
      },
    );
  });

  it.each([CHAT_MENTION_MESSAGE_KEY, CHAT_DIRECT_MESSAGE_MESSAGE_KEY])(
    "uses a live source when the oldest %s message was deleted",
    async (messageKey) => {
      seed([
        row({ id: "old", messageKey, metadata: { messageId: "deleted" } }),
        row({
          id: "new",
          messageKey,
          createdAt: JUST_A_DAY,
          metadata: { messageId: "live" },
        }),
      ]);
      chatRoomMessageFindFirstMock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "live" });

      const result = await notificationFollowUpSyncService.sendFollowUps({
        now,
      });

      expect(result.sent).toBe(1);
      expect(createNotificationMock).toHaveBeenCalledTimes(1);
      expect(firstFollowUpInput()?.metadata).toEqual({ messageId: "live" });
      expect(chatRoomMessageFindFirstMock).toHaveBeenNthCalledWith(1, {
        where: { id: "deleted", roomId: "room-1", deletedAt: null },
        select: { id: true, parentMessageId: true },
      });
    },
  );

  it.each([CHAT_MENTION_MESSAGE_KEY, CHAT_DIRECT_MESSAGE_MESSAGE_KEY])(
    "uses an unmuted source when the oldest %s thread is muted",
    async (messageKey) => {
      seed([
        row({ id: "old", messageKey, metadata: { messageId: "muted" } }),
        row({
          id: "new",
          messageKey,
          createdAt: JUST_A_DAY,
          metadata: { messageId: "live" },
        }),
      ]);
      chatRoomMessageFindFirstMock
        .mockResolvedValueOnce({ id: "muted", parentMessageId: "thread-muted" })
        .mockResolvedValueOnce({ id: "live", parentMessageId: "thread-live" });
      threadReadStateFindUniqueMock
        .mockResolvedValueOnce({ mutedAt: now })
        .mockResolvedValueOnce(null);

      const result = await notificationFollowUpSyncService.sendFollowUps({
        now,
      });
      expect(result.sent).toBe(1);
      expect(createNotificationMock).toHaveBeenCalledTimes(1);
      expect(firstFollowUpInput()?.metadata).toEqual({ messageId: "live" });
      expect(threadReadStateFindUniqueMock).toHaveBeenNthCalledWith(1, {
        where: {
          userId_parentMessageId: {
            userId: "reader-1",
            parentMessageId: "thread-muted",
          },
        },
        select: { mutedAt: true },
      });
    },
  );

  it("leaves the daily key available after a thread lookup fails", async () => {
    seed([row()]);
    chatRoomMessageFindFirstMock.mockResolvedValue({
      id: "message-1",
      parentMessageId: "thread-1",
    });
    threadReadStateFindUniqueMock.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    expect(
      (await notificationFollowUpSyncService.sendFollowUps({ now })).sent,
    ).toBe(0);
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(
      (await notificationFollowUpSyncService.sendFollowUps({ now })).sent,
    ).toBe(1);
  });

  it("does not reserve a reminder key when the source lookup fails", async () => {
    seed([row()]);
    chatRoomMessageFindFirstMock.mockRejectedValueOnce(
      new Error("unavailable"),
    );

    const failed = await notificationFollowUpSyncService.sendFollowUps({ now });
    expect(failed.sent).toBe(0);
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalled();

    const retried = await notificationFollowUpSyncService.sendFollowUps({
      now,
    });
    expect(retried.sent).toBe(1);
  });

  it("reminds a reader of a mention they never opened", async () => {
    seed([row()]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
    expect(result).toEqual({
      examined: 1,
      sent: 1,
      emailed: 0,
      reachedEnd: true,
    });
    expect(firstFollowUpInput()).toEqual({
      userId: "reader-1",
      kind: NotificationKind.CHAT,
      referenceId: "room-1",
      eventId: followUpId("room-1"),
      messageKey: CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
      messageParams: { authorName: "Ada", roomName: "Design" },
      metadata: { messageId: "message-1" },
    });
  });

  it("sends the reader back to what the notification pointed at", async () => {
    seed([
      row({ metadata: { messageId: "message-9" }, referenceId: "room-9" }),
    ]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(firstFollowUpInput()).toEqual(
      expect.objectContaining({
        referenceId: "room-9",
        metadata: { messageId: "message-9" },
      }),
    );
  });

  it("reminds a reader of a direct message they never opened", async () => {
    seed([row({ messageKey: CHAT_DIRECT_MESSAGE_MESSAGE_KEY })]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written.map((one) => one.messageKey)).toEqual([
      CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
    ]);
  });

  /**
   * Which column would not read, named in the report.
   *
   * The label is the field in Sentry and half of the key that stops one
   * damaged column being named twice. A report against the wrong column
   * sends a reader to a column that is fine and hides the one that is not.
   *
   * Its own row id, because the reader remembers what it has already said
   * for the life of the process and a shared id would silence the second
   * test to use it.
   */
  it("names the column that would not read", async () => {
    seed([{ ...row({ id: "notification-unreadable" }), metadata: "{" }]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          field: "metadata",
          rowId: "notification-unreadable",
        }),
      }),
    );
  });

  /**
   * The other column, pinned the same way. Each read passes its own label
   * and its own row id, so either can be wrong on its own, and the words
   * for both columns sit one line apart.
   */
  it("names the other column when that one would not read", async () => {
    seed([
      { ...row({ id: "notification-unreadable-params" }), messageParams: "{" },
    ]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          field: "messageParams",
          rowId: "notification-unreadable-params",
        }),
      }),
    );
  });

  it("reminds a reader of a task still waiting on them", async () => {
    seed([
      row({
        kind: NotificationKind.TASK,
        messageKey: "Notifications.Task.inputRequired",
        messageParams: { coworkerName: "Ada", taskName: "Invoice run" },
        metadata: null,
      }),
    ]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(firstFollowUpInput()).toEqual(
      expect.objectContaining({
        kind: NotificationKind.TASK,
        messageKey: TASK_FOLLOW_UP_MESSAGE_KEY,
        messageParams: { coworkerName: "Ada", taskName: "Invoice run" },
        metadata: null,
      }),
    );
    // A column with nothing in it is not a damaged column. Reading it anyway
    // parses the word null, finds no object, and reports a row that is fine,
    // which buries the damaged rows behind a dedupe cap.
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  /**
   * SOK-930 removed the job notifications, so a job row stored before that has
   * no reminder to earn: the reader cannot act on an agent job in the app.
   */
  it("says nothing more about a job", async () => {
    seed([
      row({
        kind: NotificationKind.JOB,
        messageKey: "Notifications.Job.paymentFailed",
        messageParams: { agentName: "Scribe", jobName: "Weekly digest" },
      }),
    ]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
  });

  it("says nothing more about a notification the reader opened", async () => {
    seed([row({ isRead: true })]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    expect(result).toEqual({
      examined: 0,
      sent: 0,
      emailed: 0,
      reachedEnd: true,
    });
  });

  /**
   * The read flag is the whole of the signal for a task or a job, the same as
   * it is for a chat room. Visiting the task or the job page marks that row
   * read, so a reader who fixed the thing from its own page is not reminded of
   * it. This asserts on the read state the page writes, not on the underlying
   * status: the service never reads a task or a job, and must not start to.
   *
   * The page-side write is `MarkNotificationsRead` in web, which calls
   * `PATCH /v1/notifications/read` with a reference when the task or job page
   * opens. Without it these rows stayed unread and this feature reminded
   * readers of work they had already finished.
   */
  it.each([
    [
      "task",
      {
        kind: NotificationKind.TASK,
        messageKey: "Notifications.Task.inputRequired",
        messageParams: { coworkerName: "Ada", taskName: "Invoice run" },
        metadata: null,
      },
    ],
  ])(
    "says nothing more about a %s whose page marked it read",
    async (_label, overrides) => {
      seed([row({ ...overrides, isRead: true })]);

      const result = await notificationFollowUpSyncService.sendFollowUps({
        now,
      });

      expect(written).toEqual([]);
      expect(result).toEqual({
        examined: 0,
        sent: 0,
        emailed: 0,
        reachedEnd: true,
      });
    },
  );

  /**
   * The loop checks the deadline before it starts a row, then awaits the
   * reader's preferences. That read can be the thing that crosses the
   * deadline, so the answer is checked again before anything is written.
   * Otherwise a run that is already over still starts one more write.
   */
  it("writes nothing when the deadline passes while it reads preferences", async () => {
    seed([row()]);

    let deadlinePassed = false;
    resolveDeliveryMock.mockImplementation(async () => {
      deadlinePassed = true;
      return { inApp: true, osBanner: false };
    });

    const result = await notificationFollowUpSyncService.sendFollowUps({
      now,
      shouldContinue: () => !deadlinePassed,
    });

    expect(written).toEqual([]);
    // The row was considered and the run was cut off, so it is counted and
    // the run says it did not finish. Reporting this one as finished would
    // hide the case the flag exists for.
    expect(result).toEqual({
      examined: 1,
      sent: 0,
      emailed: 0,
      reachedEnd: false,
    });
  });

  /**
   * One answer, used twice. Resolving again inside the write would let the
   * reader switch the category off between the two reads, and the row would
   * then be stored hidden while this run counted it as a reminder sent.
   */
  it("writes under the delivery it already read", async () => {
    seed([row()]);
    const delivery = { inApp: true, osBanner: true };
    // The first answer says yes and every answer after it says no, which is
    // the reader switching the category off between two reads. A second read
    // would therefore change what is written, so the answer below pins that
    // the run asks once and carries that one answer into the write.
    resolveDeliveryMock.mockResolvedValue({ inApp: false, osBanner: false });
    resolveDeliveryMock.mockResolvedValueOnce(delivery);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(resolveDeliveryMock).toHaveBeenCalledTimes(1);
    expect(firstFollowUpInput()).toEqual(
      expect.objectContaining({ eventId: followUpId("room-1") }),
    );
    // The answer itself, not one that looks like it. Which client the write
    // goes through is left alone on purpose: the parameter has a default, so
    // passing nothing there is the same call.
    expect(createNotificationMock.mock.calls[0]?.[2]).toBe(delivery);
  });

  it("waits a full day before reminding anyone", async () => {
    seed([row({ createdAt: TOO_YOUNG })]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
  });

  /**
   * Exactly a day old. The wait is "a day", not "more than a day", so the
   * instant it comes due is inside the window and not the moment after.
   */
  it("reminds a reader the moment the day is up", async () => {
    seed([row({ createdAt: JUST_A_DAY })]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
  });

  /**
   * One millisecond short of the day. The test above pins that the due
   * instant is inside the window; on its own it leaves a run free to remind
   * everyone a moment early, because the row six hours short is excluded for
   * a reason that says nothing about the edge.
   */
  it("leaves a notification a millisecond short of the day alone", async () => {
    seed([row({ createdAt: new Date(JUST_A_DAY.getTime() + 1) })]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
  });

  /**
   * Exactly at the far edge. The window is open at that instant rather than
   * closed on it, so this row belonged to the previous run and is not read
   * again here.
   */
  it("leaves a notification sitting on the window's far edge alone", async () => {
    seed([row({ createdAt: WINDOW_EDGE })]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
  });

  it("leaves a notification older than this run's window alone", async () => {
    seed([row({ createdAt: TOO_OLD })]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
  });

  /**
   * The reader silenced the category the day this arrived, so it was stored
   * with that decision on it. A reminder would hand them what they switched
   * off.
   */
  it("never reminds a reader of something they silenced", async () => {
    seed([row({ inApp: false })]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
  });

  it("says nothing about a message the reader only opted into", async () => {
    seed([row({ messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY })]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    // Never read, rather than read and then dropped. The query names the keys
    // it wants, and a run that read every unread row in the window and sorted
    // them out afterwards would say nothing here either.
    expect(result.examined).toBe(0);
  });

  it("says nothing about an outcome that waits on nobody", async () => {
    seed([
      row({
        kind: NotificationKind.TASK,
        messageKey: "Notifications.Task.completed",
      }),
      row({
        id: "notification-2",
        kind: NotificationKind.TASK,
        messageKey: "Notifications.Task.canceled",
      }),
    ]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    expect(result.examined).toBe(0);
  });

  /**
   * A damaged row costs its own reminder and not the room's.
   *
   * The reminder for a room is keyed on the room and the day, so whichever
   * row the run reaches first takes that key. If a row whose parameters will
   * not read could take it, one damaged row would leave the room with a
   * wordless reminder and no way to get a correct one, because the healthy
   * rows behind it would be refused as duplicates. So such a row is skipped
   * and the next one is reminded about instead.
   *
   * The damaged row is still reported, and still counted as examined: it was
   * looked at and passed over, not left behind by a run that stopped.
   */
  it("skips a row whose words will not read and reminds from the next", async () => {
    seed([
      {
        // An id of its own, because `notification-row-json.ts` remembers which
        // rows it has already named, per process and shared across this file.
        // A second test damaging the same id would see silence.
        ...row({ id: "notification-damaged-words", createdAt: WAITING }),
        messageParams: "{",
      },
      row({
        id: "notification-2",
        createdAt: new Date(WAITING.getTime() + 1),
        messageParams: { authorName: "Grace", roomName: "Design" },
      }),
    ]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result).toEqual({
      examined: 2,
      sent: 1,
      emailed: 0,
      reachedEnd: true,
    });
    expect(firstFollowUpInput()).toEqual(
      expect.objectContaining({
        eventId: followUpId("room-1"),
        messageParams: { authorName: "Grace", roomName: "Design" },
      }),
    );
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          field: "messageParams",
          rowId: "notification-damaged-words",
        }),
      }),
    );
  });

  /**
   * A room whose every row is damaged gets no reminder, and that is the trade.
   *
   * The alternative was a wordless reminder, which is what the old fallback
   * produced. Skipping costs this room its reminder; the fallback cost it any
   * chance of a correct one, and cost it for every later run too. Both rows
   * are still reported, so the damage is findable rather than silent.
   */
  it("says nothing about a room whose every row has lost its words", async () => {
    seed([
      {
        ...row({ id: "notification-damaged-a", createdAt: WAITING }),
        messageParams: "{",
      },
      {
        ...row({
          id: "notification-damaged-b",
          createdAt: new Date(WAITING.getTime() + 1),
        }),
        messageParams: "also not json",
      },
    ]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    // Looked at and passed over, not left behind by a run that stopped.
    expect(result).toEqual({
      examined: 2,
      sent: 0,
      emailed: 0,
      reachedEnd: true,
    });
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });

  /** One reminder, ever. The run may repeat; the reminder may not. */
  it("writes no second reminder however often the run repeats", async () => {
    seed([row()]);

    await notificationFollowUpSyncService.sendFollowUps({ now });
    const second = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
    expect(second.sent).toBe(0);
  });

  /** A reminder is not a thing to be reminded of. */
  it("never reminds a reader of a reminder", async () => {
    seed([row({ messageKey: CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY })]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    expect(result.examined).toBe(0);
  });

  /**
   * The reminder says what the original said, so every parameter the original
   * carried reaches it unchanged and none is added.
   *
   * This test used to claim more than it proved. It was called "reminds a
   * reader once about a room, however many messages it holds", and it seeded
   * one row carrying a `count`. One row in and one row out proves nothing
   * about many messages, and the seeded row could not exist: `count` is
   * written only by `countOntoUnreadRow`, whose one caller passes the
   * every-message-in-a-room key, and that key gets no follow-up.
   *
   * The test below it now covers what this one used to claim.
   */
  it("copies the original's message parameters verbatim", async () => {
    seed([
      row({
        messageParams: { authorName: "Ada", roomName: "Design" },
      }),
    ]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
    expect(firstFollowUpInput()).toEqual(
      expect.objectContaining({
        messageParams: { authorName: "Ada", roomName: "Design" },
      }),
    );
  });

  /**
   * SOK-916 user story 26: twenty unread messages in one room are one
   * reminder, not twenty.
   *
   * The mention and direct-message keys this feature follows up are written
   * one row per message (`chat-notification-fanout.ts`, `eventId:
   * params.messageId`), so the room really does arrive here as several rows.
   * What collapses them is the follow-up's event id being derived from the
   * room rather than from the row, which makes the table's own uniqueness
   * refuse the second write.
   *
   * Three rows and one reminder, so a per-row id fails this rather than
   * passing it the way a single seeded row would.
   */
  it("reminds a reader once about a room, however many messages it holds", async () => {
    seed([
      row({ id: "notification-1", metadata: { messageId: "message-1" } }),
      row({ id: "notification-2", metadata: { messageId: "message-2" } }),
      row({ id: "notification-3", metadata: { messageId: "message-3" } }),
    ]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
    // The oldest row still in the window wins, because the run goes oldest
    // first and the two after it are refused as duplicates. All three were
    // still examined.
    expect(written[0]?.eventId).toBe(followUpId("room-1"));
    expect(result).toEqual({
      examined: 3,
      sent: 1,
      emailed: 0,
      reachedEnd: true,
    });
  });

  /**
   * The other half of story 26's boundary, and story 27: one reminder per
   * room, but a reminder for each room.
   */
  it("reminds a reader about each room separately", async () => {
    seed([
      row({ id: "notification-1", referenceId: "room-1" }),
      row({ id: "notification-2", referenceId: "room-2" }),
    ]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written.map((followUp) => followUp.eventId)).toEqual([
      followUpId("room-1"),
      followUpId("room-2"),
    ]);
    expect(result).toEqual({
      examined: 2,
      sent: 2,
      emailed: 0,
      reachedEnd: true,
    });
  });

  it("writes nothing when the reader turned reminders off", async () => {
    seed([row()]);
    resolveDeliveryMock.mockResolvedValue({ inApp: false, osBanner: false });

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    expect(result).toEqual({
      examined: 1,
      sent: 0,
      emailed: 0,
      reachedEnd: true,
    });
  });

  it("still reminds a reader who wants reminders only on their device", async () => {
    seed([row()]);
    resolveDeliveryMock.mockResolvedValue({ inApp: false, osBanner: true });

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
  });

  it("carries on after one reminder fails to write", async () => {
    // Distinct instants, so the run's order is settled by `createdAt` alone
    // and this stays a test about recovering from a failed write.
    seed([
      row({ id: "notification-1", referenceId: "room-1", createdAt: WAITING }),
      row({
        id: "notification-2",
        referenceId: "room-2",
        createdAt: new Date(WAITING.getTime() + 1),
      }),
    ]);
    createNotificationMock.mockRejectedValueOnce(new Error("write failed"));

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result).toEqual({
      examined: 2,
      sent: 1,
      emailed: 0,
      reachedEnd: true,
    });
    expect(written.map((one) => one.eventId)).toEqual([followUpId("room-2")]);
    // Survived is not enough. `reachedEnd` stays true through this, so the
    // report is the only place the lost reminder is named.
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ notificationId: "notification-1" }),
      }),
    );
  });

  /**
   * A reader whose preferences will not read costs that one reminder.
   *
   * `resolveDelivery` documents itself as never throwing, so this pins the
   * loop against a future version that does rather than against today's. The
   * read is an await like any other, and letting one throw past here would
   * end the run and cost every reminder behind it.
   */
  it("carries on after one reader's preferences fail to read", async () => {
    seed([
      row({ id: "notification-1", referenceId: "room-1", createdAt: WAITING }),
      row({
        id: "notification-2",
        referenceId: "room-2",
        createdAt: new Date(WAITING.getTime() + 1),
      }),
    ]);
    resolveDeliveryMock.mockRejectedValueOnce(new Error("preferences failed"));

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result).toEqual({
      examined: 2,
      sent: 1,
      emailed: 0,
      reachedEnd: true,
    });
    expect(written.map((one) => one.eventId)).toEqual([followUpId("room-2")]);
    // As with a failed write, the report is the only place this one is named.
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ notificationId: "notification-1" }),
      }),
    );
  });

  /**
   * The preference read failed, so nothing is known about this reader.
   *
   * `resolveDelivery` never throws. It answers with a fallback that says
   * in-app, which for every other caller only drops the banner from a row
   * that was going to be written anyway. Here that answer decides whether to
   * write at all, so taking it at face value reminds a reader who switched
   * the reminder off. The row stays unread and the next run tries again.
   */
  it("says nothing to a reader whose preferences would not read", async () => {
    seed([row()]);
    resolveDeliveryMock.mockResolvedValue({
      inApp: true,
      osBanner: false,
      fellBack: true,
    });

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    // Considered and passed over, not left unread by a run that stopped.
    expect(result).toEqual({
      examined: 1,
      sent: 0,
      emailed: 0,
      reachedEnd: true,
    });
  });

  /**
   * One reader who switched the category off is one reminder skipped, not the
   * end of the run. Skipping the rest of the page would cost everyone behind
   * them, and the page moves on regardless, so they would never be read again.
   */
  it("carries on past a reader who silenced the category", async () => {
    seed([
      row({ id: "notification-1", referenceId: "room-1", createdAt: WAITING }),
      row({
        id: "notification-2",
        referenceId: "room-2",
        createdAt: new Date(WAITING.getTime() + 1),
      }),
    ]);
    resolveDeliveryMock.mockResolvedValueOnce({
      inApp: false,
      osBanner: false,
    });

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result).toEqual({
      examined: 2,
      sent: 1,
      emailed: 0,
      reachedEnd: true,
    });
    expect(written.map((one) => one.eventId)).toEqual([followUpId("room-2")]);
  });

  /**
   * A backlog larger than one read still gets reminded in this run. The read
   * is a page, not a cap, so nothing waits on a later run that may be just as
   * full.
   */
  it("reads past the first page to reach every waiting notification", async () => {
    // Three pages rather than two. A position that moved once and then stood
    // still reads the same page for ever, which two pages cannot tell apart
    // from a position that moves every time.
    const waitingCount = NOTIFICATION_FOLLOW_UP_PAGE_SIZE * 2 + 1;
    const waiting = Array.from({ length: waitingCount }, (_unused, index) =>
      row({
        id: `notification-${index}`,
        // A room of its own per row. The reminder is keyed on the room, so a
        // backlog all in one room is one reminder and would not exercise
        // paging at all.
        referenceId: `room-${index}`,
        createdAt: new Date(WAITING.getTime() + index),
      }),
    );
    seed(waiting);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result.sent).toBe(waitingCount);
    expect(written.map((one) => one.eventId)).toContain(
      followUpId(`room-${waitingCount - 1}`),
    );
    expect(notificationFindManyMock).toHaveBeenCalledTimes(3);
    // The bound on the read itself, not only on what the run does with the
    // rows. Paging in memory over an unbounded read passes every count above
    // and loads the whole backlog off the table.
    for (const [query] of notificationFindManyMock.mock.calls) {
      expect(query.take).toBe(NOTIFICATION_FOLLOW_UP_PAGE_SIZE + 1);
    }
    // Each row once. Every page starts after the last row of the one before,
    // so a position that did not advance the whole way would show up here as
    // rows handled twice long before it showed up as a slow run.
    expect(result.examined).toBe(waitingCount);
  });

  /**
   * Two rows stored in the same instant, split across a page boundary.
   *
   * The position the next page continues after is a pair, `createdAt` and
   * `id`. On `createdAt` alone the second of the two reads as "not after" the
   * first and is never reached, so the reader loses that reminder.
   */
  it("reaches the second of two notifications stored in the same instant", async () => {
    const shared = new Date(WAITING.getTime() + 1000);
    const waiting = Array.from(
      { length: NOTIFICATION_FOLLOW_UP_PAGE_SIZE + 1 },
      (_unused, index) =>
        row({
          // Ids are compared as text, so they are padded to sort the way the
          // numbers do.
          id: `notification-${String(index).padStart(4, "0")}`,
          // A room of its own per row, so the reminder keyed on the room does
          // not collapse the backlog this test needs.
          referenceId: `room-${String(index).padStart(4, "0")}`,
          // The last row of the first page and the first of the second share
          // an instant.
          createdAt:
            index >= NOTIFICATION_FOLLOW_UP_PAGE_SIZE - 1
              ? shared
              : new Date(WAITING.getTime() + index),
        }),
    );
    seed(waiting);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result.sent).toBe(NOTIFICATION_FOLLOW_UP_PAGE_SIZE + 1);
    expect(written.map((one) => one.eventId)).toContain(
      followUpId(
        `room-${String(NOTIFICATION_FOLLOW_UP_PAGE_SIZE).padStart(4, "0")}`,
      ),
    );
  });

  /**
   * A backlog that is exactly one page is a finished run, not a truncated one.
   *
   * The run reports `reachedEnd`, and false there is what says the deadline
   * ended it. A full last page must not report that on a run that in fact
   * reached the end of the eligible rows.
   */
  it("reports a backlog of exactly one page as having reached the end", async () => {
    const waiting = Array.from(
      { length: NOTIFICATION_FOLLOW_UP_PAGE_SIZE },
      (_unused, index) =>
        row({
          id: `notification-${index}`,
          // A room of its own per row, as above.
          referenceId: `room-${index}`,
          createdAt: new Date(WAITING.getTime() + index),
        }),
    );
    seed(waiting);

    // Time runs out the moment the last row is written. Without the read
    // knowing there is no next page, the run would turn the loop once more,
    // meet this, and report itself truncated.
    const result = await notificationFollowUpSyncService.sendFollowUps({
      now,
      shouldContinue: () => written.length < NOTIFICATION_FOLLOW_UP_PAGE_SIZE,
    });

    expect(result.sent).toBe(NOTIFICATION_FOLLOW_UP_PAGE_SIZE);
    expect(result.reachedEnd).toBe(true);
    expect(notificationFindManyMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The deadline is what ends a run now, so it has to end one mid-backlog and
   * not only mid-page. Without the check between pages, a run that is already
   * over still issues one more read.
   */
  it("stops between pages once the run is out of time", async () => {
    const waiting = Array.from(
      { length: NOTIFICATION_FOLLOW_UP_PAGE_SIZE * 2 },
      (_unused, index) =>
        row({
          id: `notification-${index}`,
          // A room of its own per row, as above.
          referenceId: `room-${index}`,
          createdAt: new Date(WAITING.getTime() + index),
        }),
    );
    seed(waiting);

    const result = await notificationFollowUpSyncService.sendFollowUps({
      now,
      shouldContinue: () => written.length < NOTIFICATION_FOLLOW_UP_PAGE_SIZE,
    });

    expect(result.sent).toBe(NOTIFICATION_FOLLOW_UP_PAGE_SIZE);
    expect(notificationFindManyMock).toHaveBeenCalledTimes(1);
    // Rows were left waiting here. The field does not say that on its own,
    // only that the deadline ended the run, which is what the route logs.
    expect(result.reachedEnd).toBe(false);
  });

  /**
   * Said in terms of what the run has done, not of how many times it asks.
   * Counting the probes would pin the number of checks per row, so adding one
   * would fail this test without anything about the behaviour having changed.
   */
  it("stops writing once the run is out of time", async () => {
    seed([row({ id: "notification-1" }), row({ id: "notification-2" })]);

    const result = await notificationFollowUpSyncService.sendFollowUps({
      now,
      shouldContinue: () => written.length < 1,
    });

    expect(written).toHaveLength(1);
    expect(result).toEqual({
      examined: 1,
      sent: 1,
      emailed: 0,
      reachedEnd: false,
    });
  });

  /**
   * The handler's deadline, not an abort. The two reach the loop by different
   * options, and only one of them used to be asked before the first read.
   */
  it("does not read at all when the deadline had already passed", async () => {
    const result = await notificationFollowUpSyncService.sendFollowUps({
      now,
      shouldContinue: () => false,
    });

    expect(notificationFindManyMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      examined: 0,
      sent: 0,
      emailed: 0,
      reachedEnd: false,
    });
  });

  it("does not read at all when the run was aborted before it started", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await notificationFollowUpSyncService.sendFollowUps({
      now,
      abortSignal: controller.signal,
    });

    expect(notificationFindManyMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      examined: 0,
      sent: 0,
      emailed: 0,
      reachedEnd: false,
    });
  });

  /**
   * The reminder email (SOK-916).
   *
   * These say what lands in an inbox, not how it was rendered: the words
   * themselves are the email package's tests. What matters here is that an
   * email goes to the right reader exactly when a reminder was written and
   * they asked for it, and never otherwise.
   */
  function wantsEmail() {
    resolveDeliveryMock.mockResolvedValue({
      inApp: true,
      osBanner: false,
      email: true,
    });
  }

  /** Every email this run handed over, with its body, across all its batches. */
  function emailsSent(): {
    html: string;
    subject: string;
    tag: string;
    to: string;
  }[] {
    return sendEmailsMock.mock.calls.flatMap((call) => call[0]);
  }

  it("emails a reader who wants reminders in their inbox", async () => {
    wantsEmail();
    seed([row()]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result.emailed).toBe(1);

    const [email] = emailsSent();

    expect(email.to).toBe("reader@example.com");
    expect(email.tag).toBe("notification-follow-up");
    // The room and the person waiting, which is what the mention row carried.
    expect(email.subject).toContain("Ada");
    expect(email.subject).toContain("Design");
  });

  /**
   * A reader who silenced the two cells beside email is not a reader who wants
   * nothing. The row is written unseen, which is what makes the email the only
   * one; the inbox is where the reminder arrives.
   */
  it("emails a reader who kept only the email cell", async () => {
    resolveDeliveryMock.mockResolvedValue({
      inApp: false,
      osBanner: false,
      email: true,
    });
    seed([row()]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
    expect(result.emailed).toBe(1);
    expect(emailsSent()).toHaveLength(1);
  });

  /**
   * The reminder is stored under one key per family, so the email has to read
   * the source row to say what the task actually stopped for. Passing the
   * reminder's own key instead leaves every task email saying "it needs you".
   */
  it("says in the email what the source row asked for", async () => {
    wantsEmail();
    seed([
      row({
        kind: NotificationKind.TASK,
        referenceId: "task-1",
        messageKey: "Notifications.Task.approvalRequired",
        messageParams: { coworkerName: "Ada", taskName: "Invoice run" },
        metadata: null,
      }),
    ]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    const [email] = emailsSent();

    expect(email.html).toContain("Ada needs your approval");
  });

  it("sends no email to a reader who switched that cell off", async () => {
    // The default delivery in this file says email off, which is the case.
    seed([row()]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    // The reminder still arrives in Sokosumi. Only the inbox is spared.
    expect(written).toHaveLength(1);
    expect(result.emailed).toBe(0);
    expect(sendEmailsMock).not.toHaveBeenCalled();
  });

  it("emails once per reminder and reads the reader once", async () => {
    wantsEmail();
    seed([
      row({ id: "notification-1", referenceId: "room-1" }),
      row({ id: "notification-2", referenceId: "room-2" }),
    ]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result.emailed).toBe(2);
    expect(emailsSent()).toHaveLength(2);
    // One read for the reader, not one per reminder.
    expect(userFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it("sends no second email for a reminder it did not write", async () => {
    wantsEmail();
    seed([row()]);

    await notificationFollowUpSyncService.sendFollowUps({ now });
    const second = await notificationFollowUpSyncService.sendFollowUps({ now });

    // The row stays unread, so the next run reads it again and is refused the
    // duplicate. The email follows the write rather than the read.
    expect(second.sent).toBe(0);
    expect(second.emailed).toBe(0);
    expect(emailsSent()).toHaveLength(1);
  });

  it("keeps the reminder when the send is refused", async () => {
    wantsEmail();
    sendEmailsMock.mockRejectedValue(new Error("resend refused the batch"));
    seed([row()]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    // The notification is already written and stays written. Nothing is
    // counted as emailed, because nothing in a refused chunk arrived.
    expect(written).toHaveLength(1);
    expect(result.sent).toBe(1);
    expect(result.emailed).toBe(0);
    expect(result.reachedEnd).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  /**
   * Resend takes a hundred at a time, and `sendEmails` gives up on the first
   * chunk it refuses. A page handed over whole would lose every email behind
   * the refusal, and those readers would never be mailed: their reminders are
   * already written, so the next run refuses them as duplicates.
   */
  it("carries on to the next chunk when one is refused", async () => {
    wantsEmail();
    sendEmailsMock.mockRejectedValueOnce(new Error("resend refused the chunk"));
    seed(
      Array.from({ length: 150 }, (_, index) =>
        row({ id: `notification-${index}`, referenceId: `room-${index}` }),
      ),
    );

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(150);
    // Both chunks were offered, and the fifty behind the refusal went out.
    expect(sendEmailsMock).toHaveBeenCalledTimes(2);
    expect(result.emailed).toBe(50);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("writes the reminder even when the account has gone", async () => {
    wantsEmail();
    userFindUniqueMock.mockResolvedValue(null);
    seed([row()]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
    expect(result.emailed).toBe(0);
    expect(sendEmailsMock).not.toHaveBeenCalled();
  });
});
