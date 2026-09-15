import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  JOB_FOLLOW_UP_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  createNotificationMock,
  notificationFindManyMock,
  resolveDeliveryMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  createNotificationMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  resolveDeliveryMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    notification: {
      findMany: notificationFindManyMock,
    },
  },
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
    seed([]);
    resolveDeliveryMock.mockResolvedValue({ inApp: true, osBanner: false });
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

  it("reminds a reader of a mention they never opened", async () => {
    seed([row()]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
    expect(result).toEqual({ examined: 1, sent: 1, completed: true });
    expect(firstFollowUpInput()).toEqual({
      userId: "reader-1",
      kind: NotificationKind.CHAT,
      referenceId: "room-1",
      eventId: "follow-up:notification-1",
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
  });

  it("reminds a reader of a job still waiting on them", async () => {
    seed([
      row({
        kind: NotificationKind.JOB,
        messageKey: "Notifications.Job.paymentFailed",
        messageParams: { agentName: "Scribe", jobName: "Weekly digest" },
      }),
    ]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written.map((one) => one.messageKey)).toEqual([
      JOB_FOLLOW_UP_MESSAGE_KEY,
    ]);
  });

  it("says nothing more about a notification the reader opened", async () => {
    seed([row({ isRead: true })]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    expect(result).toEqual({ examined: 0, sent: 0, completed: true });
  });

  /**
   * The read flag is the whole of the signal for a task or a job, the same as
   * it is for a chat room. Visiting the task or the job page marks that row
   * read, so a reader who fixed the thing from its own page is not reminded of
   * it. This asserts on the read state the page writes, not on the underlying
   * status: the service never reads a task or a job, and must not start to.
   *
   * The page-side write is `MarkNotificationsRead` in web, which calls
   * `PATCH /v1/notifications/read-for-reference` when the task or job page
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
    [
      "job",
      {
        kind: NotificationKind.JOB,
        messageKey: "Notifications.Job.paymentFailed",
        messageParams: { agentName: "Scribe", jobName: "Weekly digest" },
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
      expect(result).toEqual({ examined: 0, sent: 0, completed: true });
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
    expect(result).toEqual({ examined: 1, sent: 0, completed: false });
  });

  /**
   * One answer, used twice. Resolving again inside the write would let the
   * reader switch the category off between the two reads, and the row would
   * then be stored hidden while this run counted it as a reminder sent.
   */
  it("writes under the delivery it already read", async () => {
    seed([row()]);
    const delivery = { inApp: true, osBanner: true };
    resolveDeliveryMock.mockResolvedValue(delivery);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "follow-up:notification-1" }),
      expect.anything(),
      delivery,
    );
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
        kind: NotificationKind.JOB,
        messageKey: "Notifications.Job.completed",
      }),
    ]);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    expect(result.examined).toBe(0);
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
   * A room counts its messages onto one unread row, so the reminder is about
   * the room rather than about each message in it. The count is one of the
   * words the reminder says, so it has to survive the copy.
   */
  it("reminds a reader once about a room, however many messages it holds", async () => {
    seed([
      row({
        messageParams: { authorName: "Ada", count: 12, roomName: "Design" },
      }),
    ]);

    await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toHaveLength(1);
    expect(firstFollowUpInput()).toEqual(
      expect.objectContaining({
        messageParams: { authorName: "Ada", count: 12, roomName: "Design" },
      }),
    );
  });

  it("writes nothing when the reader turned reminders off", async () => {
    seed([row()]);
    resolveDeliveryMock.mockResolvedValue({ inApp: false, osBanner: false });

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(written).toEqual([]);
    expect(result).toEqual({ examined: 1, sent: 0, completed: true });
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
      row({ id: "notification-1", createdAt: WAITING }),
      row({ id: "notification-2", createdAt: new Date(WAITING.getTime() + 1) }),
    ]);
    createNotificationMock.mockRejectedValueOnce(new Error("write failed"));

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result).toEqual({ examined: 2, sent: 1, completed: true });
    expect(written.map((one) => one.eventId)).toEqual([
      "follow-up:notification-2",
    ]);
    // Survived is not enough. `completed` stays true through this, so the
    // report is the only place the lost reminder is named.
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ notificationId: "notification-1" }),
      }),
    );
  });

  /**
   * A reader whose preferences will not read costs that one reminder. The
   * read is an await like any other, so letting it throw past here would end
   * the run and cost every reminder behind it.
   */
  it("carries on after one reader's preferences fail to read", async () => {
    seed([
      row({ id: "notification-1", createdAt: WAITING }),
      row({ id: "notification-2", createdAt: new Date(WAITING.getTime() + 1) }),
    ]);
    resolveDeliveryMock.mockRejectedValueOnce(new Error("preferences failed"));

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result).toEqual({ examined: 2, sent: 1, completed: true });
    expect(written.map((one) => one.eventId)).toEqual([
      "follow-up:notification-2",
    ]);
  });

  /**
   * One reader who switched the category off is one reminder skipped, not the
   * end of the run. Skipping the rest of the page would cost everyone behind
   * them, and the page moves on regardless, so they would never be read again.
   */
  it("carries on past a reader who silenced the category", async () => {
    seed([
      row({ id: "notification-1", createdAt: WAITING }),
      row({ id: "notification-2", createdAt: new Date(WAITING.getTime() + 1) }),
    ]);
    resolveDeliveryMock.mockResolvedValueOnce({
      inApp: false,
      osBanner: false,
    });

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result).toEqual({ examined: 2, sent: 1, completed: true });
    expect(written.map((one) => one.eventId)).toEqual([
      "follow-up:notification-2",
    ]);
  });

  /**
   * A backlog larger than one read still gets reminded in this run. The read
   * is a page, not a cap, so nothing waits on a later run that may be just as
   * full.
   */
  it("reads past the first page to reach every waiting notification", async () => {
    const waiting = Array.from(
      { length: NOTIFICATION_FOLLOW_UP_PAGE_SIZE + 1 },
      (_unused, index) =>
        row({
          id: `notification-${index}`,
          createdAt: new Date(WAITING.getTime() + index),
        }),
    );
    seed(waiting);

    const result = await notificationFollowUpSyncService.sendFollowUps({ now });

    expect(result.sent).toBe(NOTIFICATION_FOLLOW_UP_PAGE_SIZE + 1);
    expect(written.map((one) => one.eventId)).toContain(
      `follow-up:notification-${NOTIFICATION_FOLLOW_UP_PAGE_SIZE}`,
    );
    expect(notificationFindManyMock).toHaveBeenCalledTimes(2);
    // Each row once. The second page starts after the last row of the first,
    // so a position that did not advance the whole way would show up here as
    // rows handled twice long before it showed up as a slow run.
    expect(result.examined).toBe(NOTIFICATION_FOLLOW_UP_PAGE_SIZE + 1);
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
      `follow-up:notification-${String(NOTIFICATION_FOLLOW_UP_PAGE_SIZE).padStart(4, "0")}`,
    );
  });

  /**
   * A backlog that is exactly one page is a finished run, not a truncated one.
   *
   * The route treats `completed: false` as the sign that reminders are being
   * left behind. A full last page must not raise that on a run that in fact
   * reached the end of the eligible rows.
   */
  it("reports a backlog of exactly one page as finished", async () => {
    const waiting = Array.from(
      { length: NOTIFICATION_FOLLOW_UP_PAGE_SIZE },
      (_unused, index) =>
        row({
          id: `notification-${index}`,
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
    expect(result.completed).toBe(true);
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
    // Rows were left waiting. One run is survivable; this is what the route
    // logs so that two in a row can be noticed.
    expect(result.completed).toBe(false);
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
    expect(result).toEqual({ examined: 1, sent: 1, completed: false });
  });

  it("does not read at all when the run was aborted before it started", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await notificationFollowUpSyncService.sendFollowUps({
      now,
      abortSignal: controller.signal,
    });

    expect(notificationFindManyMock).not.toHaveBeenCalled();
    expect(result).toEqual({ examined: 0, sent: 0, completed: false });
  });
});
