import type { Notification } from "@sokosumi/database";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Notification | null,
  deleted: false,
  sent: [] as {
    subject: string;
    html: string;
    idempotencyKey: string;
    scheduledAt?: string;
  }[],
  cancelled: [] as string[],
  duringSend: null as (() => void) | null,
  beforeReader: null as (() => void) | null,
  duringSourceLock: null as (() => void) | null,
  emailEnabled: true,
  background: [] as Promise<unknown>[],
  duringDeduplication: null as (() => void) | null,
}));
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (work: Promise<unknown>) => {
    state.background.push(work);
  },
}));
vi.mock("@/lib/ably/channel-occupancy", () => ({
  hasAppInFront: async () => true,
}));
vi.mock("@/clients/email.client", () => ({
  sendEmail: async (input: (typeof state.sent)[number]) => {
    state.sent.push(input);
    state.duringSend?.();
    return { id: `email-${state.sent.length}` };
  },
  cancelEmail: async (id: string) => {
    state.cancelled.push(id);
  },
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    notification: {
      findUnique: async () => state.row && { ...state.row },
      findMany: async ({ where }: { where: { metadata?: unknown } }) => {
        if (where.metadata && state.row) return [{ ...state.row }];
        state.duringDeduplication?.();
        return [];
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Partial<Notification>;
        data: Partial<Notification>;
      }) => {
        if (
          !state.row ||
          Object.entries(where).some(
            ([key, value]) => Reflect.get(state.row!, key) !== value,
          )
        )
          return { count: 0 };
        Object.assign(state.row, data);
        return { count: 1 };
      },
    },
    chatRoomMessage: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        deletedAt:
          state.deleted && where.id === "message-1" ? new Date(NOW) : null,
      }),
      findUnique: async () => ({
        content: state.deleted ? "" : "First private text",
        deletedAt: state.deleted ? new Date(NOW) : null,
      }),
    },
    user: {
      findUnique: async () => {
        state.beforeReader?.();
        return {
          email: "reader@example.com",
          name: "Grace",
          pushOptIn: true,
          notificationPreferences: [
            {
              category: "CHAT_ROOM_MESSAGE",
              channel: "EMAIL",
              enabled: state.emailEnabled,
            },
          ],
        };
      },
    },
    $queryRaw: async () => {
      state.duringSourceLock?.();
      return [];
    },
  };
  return {
    default: {
      ...client,
      $transaction: async (work: (tx: typeof client) => Promise<unknown>) =>
        work(client),
    },
  };
});

import { rewriteChatNotificationPreviews } from "./chat-notification-fanout";
import { notificationEmailContentRevision } from "./notification-chat-email-source";
import {
  cancelNotificationEmails,
  dispatchNotificationEmail,
} from "./notification-email-dispatch";
import { resendRoomMessageEmail } from "./notification-email-resend";

const NOW = Date.parse("2026-11-01T10:00:00.000Z");
function row(): Notification {
  return {
    id: "notification-1",
    userId: "reader",
    workspaceId: null,
    organizationId: null,
    kind: "CHAT",
    referenceId: "room-1",
    eventId: "message-1",
    messageKey: "Notifications.Chat.roomMessage",
    messageParams: JSON.stringify({
      authorName: "Ada",
      roomName: "Design",
      messagePreview: "First private text",
      count: 1,
    }),
    metadata: JSON.stringify({ messageId: "message-1" }),
    inApp: true,
    isRead: false,
    readAt: null,
    createdAt: new Date(NOW),
    emailId: null,
    emailScheduledAt: null,
    publishId: null,
    publishPush: null,
    publishCreated: null,
    publishQueuedAt: null,
    publishNextAttemptAt: null,
  };
}
function corrected(): string {
  return JSON.stringify({
    authorName: "Ada",
    roomName: "Design",
    messagePreview: "Corrected text",
    count: 1,
  });
}
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  state.row = row();
  state.deleted = false;
  state.sent.length = 0;
  state.cancelled.length = 0;
  state.duringSend = null;
  state.beforeReader = null;
  state.duringSourceLock = null;
  state.emailEnabled = true;
  state.background.length = 0;
  state.duringDeduplication = null;
});
afterEach(() => vi.restoreAllMocks());

it("sends no email after its source message was deleted", async () => {
  state.deleted = true;
  await dispatchNotificationEmail(row());
  expect(state.sent).toHaveLength(0);
});
it("cancels scheduled mail when deletion lands during provider handoff", async () => {
  state.duringSend = () => {
    state.deleted = true;
  };
  await dispatchNotificationEmail(row());
  expect(state.sent).toHaveLength(1);
  expect(state.cancelled).toEqual(["email-1"]);
  expect(state.row?.emailId).toBeNull();
});
it.each([
  ["edited", () => void (state.row!.messageParams = corrected())],
  ["deleted", () => void (state.deleted = true)],
])(
  "records an immediate email although its message was %s during the handoff",
  async (_change, change) => {
    state.duringSend = change;
    await dispatchNotificationEmail(row(), { scheduledAt: null });
    expect(state.sent).toHaveLength(1);
    expect(state.cancelled).toEqual([]);
    expect(state.row?.emailId).toBe("email-1");
  },
);
it("sends again for the room alone when its message goes during a first send", async () => {
  // No preview, so the deletion leaves the row's bytes as they are: only
  // the source moved, from the message to the room.
  state.row = {
    ...row(),
    messageParams: JSON.stringify({
      authorName: "Ada",
      roomName: "Design",
      count: 2,
    }),
  };
  state.duringSend = () => {
    state.duringSend = null;
    state.deleted = true;
  };
  await dispatchNotificationEmail(state.row);
  expect(state.sent).toHaveLength(2);
  expect(state.sent[0]?.html).toContain("message=message-1");
  expect(state.sent[1]?.idempotencyKey).toMatch(/\/room$/);
  expect(state.sent[1]?.html).not.toContain("message=message-1");
  expect(state.cancelled).toEqual(["email-1"]);
  expect(state.row.emailId).toBe("email-2");
});
it.each([
  // The first send is still in flight: name the time it promised.
  [120_000, NOW + 600_000],
  // The first send never left and its promised time has passed: wait again.
  [7_200_000, NOW + 7_200_000 + 600_000],
])(
  "sends counted mail %i ms after the row at the time the row promised",
  async (elapsed, scheduledAt) => {
    vi.spyOn(Date, "now").mockReturnValue(NOW + elapsed);
    await resendRoomMessageEmail("notification-1", { allowInitialSend: true });
    expect(state.sent[0]?.scheduledAt).toBe(
      new Date(scheduledAt).toISOString(),
    );
  },
);
it("cancels existing pending mail when its source is deleted", async () => {
  state.row = {
    ...row(),
    emailId: "old-email",
    emailScheduledAt: new Date(NOW + 600_000),
  };
  state.deleted = true;
  await resendRoomMessageEmail("notification-1");
  expect(state.sent).toHaveLength(0);
  expect(state.cancelled).toEqual(["old-email"]);
  expect(state.row.emailId).toBeNull();
});
it("keeps the counted email for earlier arrivals when the latest message is deleted", async () => {
  state.row = {
    ...row(),
    messageParams: JSON.stringify({
      authorName: "Ada",
      roomName: "Design",
      count: 2,
    }),
    emailId: "old-email",
    emailScheduledAt: new Date(NOW + 600_000),
  };
  state.deleted = true;
  await resendRoomMessageEmail("notification-1");
  expect(state.sent[0]?.subject).toBe("Sokosumi - 2 unread messages in Design");
  // No link to the lost message.
  expect(state.sent[0]?.html).not.toContain("message=message-1");
  // The row's bytes did not change with the deletion, so the key must say
  // what did: a message send under the same key would be replayed, or this
  // one refused as a different payload.
  expect(state.sent[0]?.idempotencyKey).toBe(
    `notification-email/notification-1/2/${notificationEmailContentRevision(state.row)}/room`,
  );
  expect(state.cancelled).toEqual(["old-email"]);
  expect(state.row.emailId).toBe("email-1");
});
it("keeps the time the row already promised when a first send is refreshed", async () => {
  state.duringSend = () => {
    state.duringSend = null;
    state.row = {
      ...state.row!,
      createdAt: new Date(NOW + 120_000),
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Design",
        count: 2,
      }),
      emailId: "other-email",
      emailScheduledAt: new Date(NOW + 300_000),
    };
  };
  await dispatchNotificationEmail(row());
  expect(state.sent[1]?.scheduledAt).toBe(
    new Date(NOW + 300_000).toISOString(),
  );
});
it("names the moved row's time when a first send is refreshed", async () => {
  // A counted arrival moved the row while the first send was in flight. Its
  // own recovery send reads the time from the moved row, under the same key.
  state.duringSend = () => {
    state.duringSend = null;
    state.row = {
      ...state.row!,
      createdAt: new Date(NOW + 120_000),
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Design",
        count: 2,
      }),
    };
  };
  await dispatchNotificationEmail(row());
  expect(state.sent[1]?.scheduledAt).toBe(
    new Date(NOW + 120_000 + 600_000).toISOString(),
  );
});
it("takes back an email another send put on the row while this one was refreshed", async () => {
  state.duringSend = () => {
    state.duringSend = null;
    state.row = {
      ...state.row!,
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "Design",
        count: 2,
      }),
      emailId: "other-email",
      emailScheduledAt: new Date(NOW + 600_000),
    };
  };
  await dispatchNotificationEmail(row());
  expect(state.sent).toHaveLength(2);
  expect(state.cancelled).toEqual(["email-1", "other-email"]);
  expect(state.row?.emailId).toBe("email-2");
});
it("builds counted mail from the committed row instead of the old caller snapshot", async () => {
  const stale = row();
  state.row = {
    ...stale,
    messageParams: JSON.stringify({
      authorName: "Ada",
      roomName: "Design",
      count: 2,
    }),
  };
  await dispatchNotificationEmail(stale);
  expect(state.sent[0]?.subject).toBe("Sokosumi - 2 unread messages in Design");
});
it("replaces an edited pending email even when its count stays the same", async () => {
  await dispatchNotificationEmail(row());
  const originalKey = state.sent[0]?.idempotencyKey;
  state.row!.messageParams = JSON.stringify({
    authorName: "Ada",
    roomName: "Design",
    count: 1,
    messagePreview: "Corrected text",
  });
  await resendRoomMessageEmail("notification-1");
  expect(state.sent[1]?.html).toContain("Corrected text");
  expect(state.sent[1]?.idempotencyKey).not.toBe(originalKey);
  expect(state.cancelled).toEqual(["email-1"]);
});

it.each(["before", "during", "source-lock"])(
  "keeps a newer live arrival when the old source is deleted %s send",
  async (timing) => {
    const advance = () => {
      state.deleted = true;
      state.beforeReader = null;
      state.duringSend = null;
      state.duringSourceLock = null;
      state.row = {
        ...state.row!,
        metadata: JSON.stringify({ messageId: "message-2" }),
        messageParams: JSON.stringify({
          authorName: "Ada",
          roomName: "Design",
          count: 2,
        }),
      };
    };
    if (timing === "before") state.beforeReader = advance;
    else if (timing === "during") state.duringSend = advance;
    else state.duringSourceLock = advance;
    await dispatchNotificationEmail(row());
    expect(state.sent.at(-1)?.subject).toBe(
      "Sokosumi - 2 unread messages in Design",
    );
    expect(state.sent.at(-1)?.html).toContain("message=message-2");
    expect(state.row?.emailId).toBe(`email-${state.sent.length}`);
  },
);

it("does not clear a newer email when an older cancellation finishes", async () => {
  state.row = {
    ...row(),
    emailId: "new-email",
    emailScheduledAt: new Date(NOW + 600_000),
  };
  await cancelNotificationEmails([
    {
      id: "notification-1",
      emailId: "old-email",
      emailScheduledAt: new Date(NOW + 600_000),
    },
  ]);
  expect(state.cancelled).toEqual(["old-email"]);
  expect(state.row.emailId).toBe("new-email");
});

it("mails a new counted arrival after a deleted source lost its first send", async () => {
  state.deleted = true;
  await dispatchNotificationEmail(row());
  expect(state.sent).toHaveLength(0);
  state.row = {
    ...row(),
    metadata: JSON.stringify({ messageId: "message-2" }),
    messageParams: JSON.stringify({
      authorName: "Ada",
      roomName: "Design",
      count: 2,
    }),
  };
  await resendRoomMessageEmail("notification-1", { allowInitialSend: true });
  expect(state.sent[0]?.subject).toBe("Sokosumi - 2 unread messages in Design");
  expect(state.row.emailId).toBe("email-1");
});

it("does not start counted mail when the email preference is off", async () => {
  state.emailEnabled = false;
  await resendRoomMessageEmail("notification-1", { allowInitialSend: true });
  expect(state.sent).toHaveLength(0);
});

it("does not start an unscheduled email from a preview rewrite", async () => {
  await resendRoomMessageEmail("notification-1");
  expect(state.sent).toHaveLength(0);
});

it("takes back pending mail when deletion rewrites its stored notification", async () => {
  state.row = {
    ...row(),
    emailId: "old-email",
    emailScheduledAt: new Date(NOW + 600_000),
  };
  state.deleted = true;
  await rewriteChatNotificationPreviews({
    roomId: "room-1",
    messageId: "message-1",
  });
  await Promise.all(state.background);
  expect(JSON.parse(state.row.messageParams).messagePreview).toBeUndefined();
  expect(state.cancelled).toEqual(["old-email"]);
  expect(state.sent).toHaveLength(0);
});

it.each([null, "{", JSON.stringify({ messageId: 55 })])(
  "does not email an unverifiable source (%s)",
  async (metadata) => {
    state.row = { ...row(), metadata };
    await dispatchNotificationEmail(row());
    expect(state.sent).toHaveLength(0);
  },
);

it("cancels deleted-message mail even when its notification was already read", async () => {
  state.row = {
    ...row(),
    isRead: true,
    emailId: "old-email",
    emailScheduledAt: new Date(NOW + 600_000),
  };
  state.deleted = true;
  await resendRoomMessageEmail("notification-1");
  expect(state.cancelled).toEqual(["old-email"]);
  expect(state.sent).toHaveLength(0);
});

it("sends for the room alone when its message goes before a first send leaves", async () => {
  // The same row as above, with the deletion landing between the queue
  // turn's source check and the provider handoff: nothing to take back.
  state.row = {
    ...row(),
    messageParams: JSON.stringify({
      authorName: "Ada",
      roomName: "Design",
      count: 2,
    }),
  };
  state.duringDeduplication = () => {
    state.duringDeduplication = null;
    state.deleted = true;
  };
  await dispatchNotificationEmail(state.row);
  expect(state.sent).toHaveLength(1);
  expect(state.sent[0]?.idempotencyKey).toMatch(/\/room$/);
  expect(state.sent[0]?.html).not.toContain("message=message-1");
  expect(state.cancelled).toEqual([]);
  expect(state.row.emailId).toBe("email-1");
});

it("rechecks deletion after the earlier-email lookup before an immediate send", async () => {
  state.row = { ...row(), messageKey: "Notifications.Chat.mentioned" };
  state.duringDeduplication = () => {
    state.deleted = true;
  };
  await dispatchNotificationEmail(state.row, { scheduledAt: null });
  expect(state.sent).toHaveLength(0);
});
