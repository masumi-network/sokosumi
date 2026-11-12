import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Retry and stale reclaim of a Soko Bot mention, against a real database.
 *
 * Only the turn start (the model) and realtime fan-out are stubbed. The
 * dispatch, the Retry release, the delivery outbox and the chat write are the
 * real ones, so these assert what lands in the room and on the mention:
 *
 * - a reclaimed mention whose turn completed with its delivery still pending
 *   gets that answer, not a second turn;
 * - a turn that completed after the dispatch looked keeps its answer instead
 *   of becoming a failed card;
 * - Retry releases only a failed turn with nothing left to deliver, and the
 *   next start runs under a key of its own;
 * - Retry through the real route while the failed card's delivery is still
 *   PERSISTED (its publication failed) leaves the card failed, not
 *   "Thinking…", and once that publication lands the next Retry starts a
 *   fresh turn under one stable key;
 * - an old dispatch that resumes after Retry handed the mention to a fresh
 *   attempt changes nothing, and the fresh answer lands;
 * - nothing a concurrent publisher can read during that Retry is
 *   "Thinking…", so a delayed event cannot cover the failed card, while a
 *   fresh Retry's "Thinking…" still replaces it;
 * - an old dispatch whose ownership check itself fails, through the public
 *   entry, still writes nothing over the fresh attempt;
 * - a dispatch that found the turn running, which then fails and is retried
 *   before the dispatch goes on, never reopens "Thinking…".
 */

const { startTurn, publish, background, afterOutboxPush, hold } = vi.hoisted(
  () => ({
    // One-shot holds on the public dispatch: before its workspace lookup
    // (before the claim) and before its room context read (after it).
    hold: {
      workspace: null as null | (() => Promise<void>),
      context: null as null | (() => Promise<void>),
    },
    startTurn: vi.fn(),
    publish: vi.fn(),
    background: [] as Promise<unknown>[],
    // Where a dispatch settling an ended turn waits once that turn's delivery
    // push returned, before it puts the outcome back on the reply.
    afterOutboxPush: { current: null as null | (() => Promise<void>) },
  }),
);
vi.mock("@/services/soko-bot-delivery.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-delivery.service")
    >();
  return {
    ...actual,
    deliverSokoBotTurnOutbox: async (turnId: string) => {
      await actual.deliverSokoBotTurnOutbox(turnId);
      await afterOutboxPush.current?.();
    },
  };
});
vi.mock("@/routes/v1/chats/rooms/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/routes/v1/chats/rooms/helpers")>();
  return {
    ...actual,
    resolveWorkspaceIdForChatRoom: async (
      ...args: Parameters<typeof actual.resolveWorkspaceIdForChatRoom>
    ) => {
      const held = hold.workspace;
      hold.workspace = null;
      await held?.();
      return actual.resolveWorkspaceIdForChatRoom(...args);
    },
  };
});
vi.mock("./chat-room-mention-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./chat-room-mention-context")>();
  return {
    ...actual,
    loadRoomContextMessages: async (
      ...args: Parameters<typeof actual.loadRoomContextMessages>
    ) => {
      const held = hold.context;
      hold.context = null;
      await held?.();
      return actual.loadRoomContextMessages(...args);
    },
  };
});
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: publish,
  publishChatRoomMessageRealtime: vi.fn(),
}));
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: (work: Promise<unknown>) => {
    background.push(work);
  },
}));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("@/helpers/chat-room-message-created-effects", () => ({
  invalidateChatRoomMessageReaders: vi.fn(),
}));
vi.mock("@/helpers/chat-mention-notifications", () => ({
  emitChatMentionNotifications: vi.fn(),
}));
vi.mock("@/helpers/chat-direct-message-notifications", () => ({
  emitChatDirectMessageNotifications: vi.fn(),
  shouldEmitChatDirectMessageNotifications: () => false,
}));
// Notification fan-out goes to Ably, which CI has no key for; the mention
// rows it reads are still written for real.
vi.mock("@/helpers/chat-human-mentions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/chat-human-mentions")>()),
  emitChatMessageNotifications: vi.fn(),
}));
vi.mock("@/services/soko-bot-control-plane.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-control-plane.service")
    >();
  return {
    ...actual,
    sokoBotControlPlane: { startTurn, reconcileTurn: vi.fn() },
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("Soko Bot mention retry and reclaim", () => {
  let db: typeof import("@/lib/db/prisma").default;
  let dispatch: typeof import("./chat-room-soko-bot-dispatch.service").runSokoBotMentionDispatch;
  let release: typeof import("./chat-room-mention-state").releaseFailedTurnForRetry;
  let enqueue: typeof import("./soko-bot-delivery.service").enqueueSokoBotDelivery;
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const botId = randomUUID();
  const roomId = randomUUID();

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).default;
    dispatch = (await import("./chat-room-soko-bot-dispatch.service"))
      .runSokoBotMentionDispatch;
    release = (await import("./chat-room-mention-state"))
      .releaseFailedTurnForRetry;
    enqueue = (await import("./soko-bot-delivery.service"))
      .enqueueSokoBotDelivery;
    await db.user.create({
      data: {
        id: userId,
        name: "Retry fixture",
        email: `retry-${userId}@sokosumi.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await db.workspace.create({ data: { id: workspaceId, userId } });
    await db.sokoBot.create({ data: { id: botId, userId, workspaceId } });
    await db.chatRoom.create({
      data: {
        id: roomId,
        name: "Retry fixture",
        kind: "direct",
        directKey: `retry:${roomId}`,
        createdByUserId: userId,
        userMembers: { create: { userId } },
        sokoBotMembers: { create: { sokoBotId: botId } },
      },
    });
  });
  afterAll(async () => {
    if (!db) return;
    await db.chatRoom.deleteMany({ where: { id: roomId } });
    await db.sokoBotTurn.deleteMany({ where: { sokoBotId: botId } });
    await db.user.deleteMany({ where: { id: userId } });
  });
  beforeEach(() => {
    afterOutboxPush.current = null;
    hold.workspace = null;
    hold.context = null;
    startTurn.mockReset();
    publish.mockReset();
    publish.mockResolvedValue(undefined);
  });

  /** A mention left `sent` long enough ago for stale reclaim to claim it. */
  async function staleMention() {
    const source = await db.chatRoomMessage.create({
      data: { roomId, senderUserId: userId, content: "What is due today?" },
    });
    const response = await db.chatRoomMessage.create({
      data: { roomId, senderSokoBotId: botId, content: "" },
    });
    const mention = await db.chatRoomMention.create({
      data: {
        messageId: source.id,
        sokoBotId: botId,
        responseMessageId: response.id,
        status: "sent",
      },
    });
    await db.$executeRaw`UPDATE chat_room_mention SET "updatedAt" = now() - interval '1 hour' WHERE id = ${mention.id}::uuid`;
    return { source, response, mention };
  }

  async function turnFor(
    m: Awaited<ReturnType<typeof staleMention>>,
    status: "COMPLETED" | "FAILED",
  ) {
    const turn = await db.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        requestedByUserId: userId,
        workspaceId,
        source: "CHAT",
        status,
        clientTurnId: `chat:${m.mention.id}`,
        userMessage: "What is due today?",
        finalAnswer: status === "COMPLETED" ? "Two invoices are due." : null,
        errorDetail: status === "FAILED" ? "Gateway refused" : null,
        chatMentionId: m.mention.id,
        chatResponseMessageId: m.response.id,
        capabilityNames: [],
        deadlineAt: new Date(Date.now() + 60_000),
        destinationRoomId: roomId,
        destinationAudience: {
          userIds: [userId],
          coworkerIds: [],
          botIds: [botId],
        },
      },
    });
    await db.$transaction((tx) => enqueue(tx, turn.id));
    return turn;
  }

  async function runDispatch(m: Awaited<ReturnType<typeof staleMention>>) {
    const mention = await db.chatRoomMention.findUniqueOrThrow({
      where: { id: m.mention.id },
      include: {
        sokoBot: {
          select: {
            id: true,
            userId: true,
            workspaceId: true,
            archivedAt: true,
          },
        },
        message: {
          include: {
            room: {
              select: {
                id: true,
                kind: true,
                name: true,
                organizationId: true,
              },
            },
            senderUser: { select: { id: true, name: true } },
          },
        },
      },
    });
    await dispatch({
      mentionId: mention.id,
      mention,
      userId,
      failWithShell: async () => {
        throw new Error("not expected");
      },
      askedByBot: false,
      chainDepth: 0,
    });
  }

  it("delivers a completed turn's pending answer on reclaim, without a second turn", async () => {
    const m = await staleMention();
    const turn = await turnFor(m, "COMPLETED");
    startTurn.mockResolvedValue({
      turnId: turn.id,
      status: "COMPLETED",
      duplicate: true,
    });

    await runDispatch(m);

    // The turn holding the mention already ended: no start, no second turn.
    expect(startTurn).not.toHaveBeenCalled();
    expect(
      await db.sokoBotTurn.count({
        where: { clientTurnId: { startsWith: `chat:${m.mention.id}` } },
      }),
    ).toBe(1);
    expect(
      await db.sokoBotTurn.findUnique({ where: { id: turn.id } }),
    ).toMatchObject({ chatMentionId: m.mention.id });
    expect(
      await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
    ).toMatchObject({ status: "responded" });
    expect(
      await db.chatRoomMessage.findUnique({ where: { id: m.response.id } }),
    ).toMatchObject({ content: "Two invoices are due." });
    expect(
      await db.sokoBotDelivery.findFirst({ where: { turnId: turn.id } }),
    ).toMatchObject({ status: "PUBLISHED" });
  });

  it("keeps the answer of a turn that completed after its delivery already ran", async () => {
    const m = await staleMention();
    const turn = await turnFor(m, "COMPLETED");
    // Its delivery ran while the mention was being reclaimed, so nothing is
    // left to deliver and the mention is still `sent`.
    await db.sokoBotDelivery.updateMany({
      where: { turnId: turn.id },
      data: { status: "PUBLISHED" },
    });
    startTurn.mockResolvedValue({
      turnId: turn.id,
      status: "COMPLETED",
      duplicate: true,
    });

    await runDispatch(m);

    expect(
      await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
    ).toMatchObject({ status: "responded" });
    const reply = await db.chatRoomMessage.findUniqueOrThrow({
      where: { id: m.response.id },
    });
    expect(reply.content).toBe("Two invoices are due.");
    expect(reply.metadata).not.toMatchObject({ mention_failed: true });
    expect(publish).toHaveBeenCalledWith(m.response.id, "update");
  });

  it("lets Retry release only a failed turn with nothing left to deliver", async () => {
    const pendingFailed = await staleMention();
    const keep = await turnFor(pendingFailed, "FAILED");
    await db.$transaction((tx) => release(tx, pendingFailed.mention.id));
    expect(
      await db.sokoBotTurn.findUnique({ where: { id: keep.id } }),
    ).toMatchObject({ chatMentionId: pendingFailed.mention.id });

    const completed = await staleMention();
    const done = await turnFor(completed, "COMPLETED");
    await db.sokoBotDelivery.updateMany({
      where: { turnId: done.id },
      data: { status: "PUBLISHED" },
    });
    await db.$transaction((tx) => release(tx, completed.mention.id));
    expect(
      await db.sokoBotTurn.findUnique({ where: { id: done.id } }),
    ).toMatchObject({ chatMentionId: completed.mention.id });

    const failed = await staleMention();
    const old = await turnFor(failed, "FAILED");
    await db.sokoBotDelivery.updateMany({
      where: { turnId: old.id },
      data: { status: "PUBLISHED" },
    });
    await db.$transaction((tx) => release(tx, failed.mention.id));
    expect(
      await db.sokoBotTurn.findUnique({ where: { id: old.id } }),
    ).toMatchObject({
      chatMentionId: null,
      chatResponseMessageId: failed.response.id,
      destinationRoomId: roomId,
    });

    await db.chatRoomMention.update({
      where: { id: failed.mention.id },
      data: { status: "pending" },
    });
    startTurn.mockResolvedValue({ turnId: randomUUID(), status: "QUEUED" });
    await runDispatch(failed);
    expect(startTurn.mock.calls[0][0].clientTurnId).toBe(
      `chat:${failed.mention.id}:retry:${old.id}`,
    );
  });

  it("keeps the failed card through Retry while its publication is still owed, then retries fresh", async () => {
    const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
    const mountRetry = (
      await import(
        "@/routes/v1/chats/rooms/[id]/messages/[messageId]/mentions/[mentionId]/retry/post"
      )
    ).default;
    const { deliverSokoBotDelivery } = await import(
      "./soko-bot-delivery.service"
    );
    const app = new OpenAPIHonoWithAuth();
    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId,
        organizationId: null,
        role: "user",
      } as never);
      return next();
    });
    mountRetry(app);

    const m = await staleMention();
    const old = await turnFor(m, "FAILED");
    const delivery = await db.sokoBotDelivery.findFirstOrThrow({
      where: { turnId: old.id },
    });
    // The failed card is written, then its publication fails: PERSISTED, in
    // backoff.
    publish.mockRejectedValue(new Error("Ably invalid key"));
    expect(await deliverSokoBotDelivery(delivery.id)).toBe(false);
    expect(
      await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
    ).toMatchObject({ status: "PERSISTED" });
    expect(
      await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
    ).toMatchObject({ status: "failed" });
    publish.mockReset();
    publish.mockResolvedValue(undefined);

    // The model start hands back the turn holding a key, as startTurn does.
    startTurn.mockImplementation(async (start: { clientTurnId: string }) =>
      start.clientTurnId === `chat:${m.mention.id}`
        ? { turnId: old.id, status: "FAILED", duplicate: true }
        : { turnId: randomUUID(), status: "QUEUED", duplicate: false },
    );
    const retry = async () => {
      background.length = 0;
      const response = await app.request(
        `/${roomId}/messages/${m.source.id}/mentions/${m.mention.id}/retry`,
        { method: "POST" },
      );
      await Promise.all(background);
      return response.status;
    };
    const reply = async () => {
      const message = await db.chatRoomMessage.findUniqueOrThrow({
        where: { id: m.response.id },
      });
      return message.metadata as Record<string, unknown>;
    };

    // Every reply event as the room receives it (the snapshot read when
    // published), and the one a concurrent publisher of the owed delivery
    // reads mid-dispatch and sends only after the dispatch finished.
    const events: Record<string, unknown>[] = [];
    publish.mockImplementation(async (id: string) => {
      if (id === m.response.id) events.push(await reply());
    });
    let delayed: Record<string, unknown> | undefined;
    afterOutboxPush.current = async () => {
      delayed = await reply();
    };
    // The client keeps the last full event for a message id
    // (`applyFullChatRoomMessageEvent` in Web's merge-room-messages.ts).
    const shown = () => (delayed ? [...events, delayed] : events).at(-1);

    // Retry while the publication is still owed: the old turn keeps the
    // mention, and the reply ends failed again, never "Thinking…".
    expect(await retry()).toBe(200);
    expect(startTurn).not.toHaveBeenCalled();
    expect(delayed).toMatchObject({ mention_failed: true });
    expect(events.some((event) => event.streaming === true)).toBe(false);
    expect(shown()).toMatchObject({ mention_failed: true });
    expect(
      await db.sokoBotTurn.findUnique({ where: { id: old.id } }),
    ).toMatchObject({ chatMentionId: m.mention.id });
    expect(
      await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
    ).toMatchObject({ status: "failed" });
    expect(await reply()).toMatchObject({ mention_failed: true });
    expect((await reply()).streaming).not.toBe(true);

    // The owed publication lands and leaves the card as it is.
    await db.sokoBotDelivery.update({
      where: { id: delivery.id },
      data: { nextAttemptAt: new Date(0) },
    });
    expect(await deliverSokoBotDelivery(delivery.id)).toBe(true);
    expect(
      await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
    ).toMatchObject({ status: "PUBLISHED" });
    expect(await reply()).toMatchObject({ mention_failed: true });
    expect((await reply()).streaming).not.toBe(true);

    // Now Retry lets go of the old turn and starts a fresh one, whose
    // "Thinking…" replaces the failed card.
    startTurn.mockClear();
    events.length = 0;
    delayed = undefined;
    expect(await retry()).toBe(200);
    expect(shown()).toMatchObject({ streaming: true });
    expect(shown()?.mention_failed).toBeUndefined();
    expect(
      await db.sokoBotTurn.findUnique({ where: { id: old.id } }),
    ).toMatchObject({
      chatMentionId: null,
      chatResponseMessageId: m.response.id,
    });
    const fresh = `chat:${m.mention.id}:retry:${old.id}`;
    expect(startTurn.mock.calls.map(([start]) => start.clientTurnId)).toEqual([
      fresh,
    ]);
    // Another worker deriving the key for this attempt gets the same one.
    await db.chatRoomMention.update({
      where: { id: m.mention.id },
      data: { status: "pending" },
    });
    startTurn.mockClear();
    await runDispatch(m);
    expect(startTurn.mock.calls.map(([start]) => start.clientTurnId)).toEqual([
      fresh,
    ]);
  });

  it.each([
    { entry: "inner dispatch", faultFence: false },
    // Through the public entry, with the ownership check's transaction
    // failing: nothing may fall back to an unchecked write.
    { entry: "public dispatch", faultFence: true },
  ])(
    "lets an old dispatch resuming after Retry leave the fresh attempt and its answer alone ($entry)",
    async ({ faultFence }) => {
      const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
      const mountRetry = (
        await import(
          "@/routes/v1/chats/rooms/[id]/messages/[messageId]/mentions/[mentionId]/retry/post"
        )
      ).default;
      const { deliverSokoBotDelivery } = await import(
        "./soko-bot-delivery.service"
      );
      const app = new OpenAPIHonoWithAuth();
      app.use("*", async (c, next) => {
        c.set("isAuthenticated", true);
        c.set("authContext", {
          actor: "user",
          userId,
          organizationId: null,
          role: "user",
        } as never);
        return next();
      });
      mountRetry(app);

      const m = await staleMention();
      const old = await turnFor(m, "FAILED");
      const fresh = `chat:${m.mention.id}:retry:${old.id}`;
      // The fresh attempt's start inserts its turn on the mention, as startTurn
      // does, and leaves it running.
      let freshTurnId: string | undefined;
      startTurn.mockImplementation(async (start: { clientTurnId: string }) => {
        const turn = await db.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            requestedByUserId: userId,
            workspaceId,
            source: "CHAT",
            status: "RUNNING",
            clientTurnId: start.clientTurnId,
            userMessage: "What is due today?",
            chatMentionId: m.mention.id,
            chatResponseMessageId: m.response.id,
            capabilityNames: [],
            deadlineAt: new Date(Date.now() + 60_000),
            destinationRoomId: roomId,
            destinationAudience: {
              userIds: [userId],
              coworkerIds: [],
              botIds: [botId],
            },
          },
        });
        freshTurnId = turn.id;
        return { turnId: turn.id, status: "RUNNING", duplicate: false };
      });

      // The old dispatch (stale reclaim of the failed turn) pushes its delivery:
      // failed card and failed mention, PUBLISHED. Hold it right there.
      let reached!: () => void;
      const atHold = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let resume!: () => void;
      const held = new Promise<void>((resolve) => {
        resume = resolve;
      });
      afterOutboxPush.current = async () => {
        reached();
        await held;
      };
      const oldDispatch = faultFence
        ? (
            await import("./chat-room-coworker-dispatch.service")
          ).dispatchChatRoomMention(m.mention.id)
        : runDispatch(m);
      await atHold;
      afterOutboxPush.current = null;
      expect(
        await db.sokoBotDelivery.findFirst({ where: { turnId: old.id } }),
      ).toMatchObject({ status: "PUBLISHED" });
      expect(
        await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
      ).toMatchObject({ status: "failed" });

      // Real Retry: releases the old turn and starts the fresh attempt.
      background.length = 0;
      const response = await app.request(
        `/${roomId}/messages/${m.source.id}/mentions/${m.mention.id}/retry`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
      await Promise.all(background);
      expect(startTurn.mock.calls.map(([start]) => start.clientTurnId)).toEqual(
        [fresh],
      );

      // The old dispatch resumes and must not touch the fresh attempt.
      const fenceFault = faultFence
        ? vi
            .spyOn(db, "$transaction")
            .mockRejectedValue(new Error("Transaction API error: timeout"))
        : null;
      resume();
      await oldDispatch;
      if (fenceFault) {
        expect(fenceFault).toHaveBeenCalled();
        fenceFault.mockRestore();
      }
      expect(
        await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
      ).toMatchObject({ status: "sent" });
      const running = await db.chatRoomMessage.findUniqueOrThrow({
        where: { id: m.response.id },
      });
      expect(running.metadata).toMatchObject({ streaming: true });
      expect(running.metadata).not.toMatchObject({ mention_failed: true });

      // The fresh turn completes and its answer lands through the real delivery.
      if (!freshTurnId) throw new Error("fresh turn not started");
      await db.sokoBotTurn.update({
        where: { id: freshTurnId },
        data: { status: "COMPLETED", finalAnswer: "Three invoices are due." },
      });
      await db.$transaction((tx) => enqueue(tx, freshTurnId as string));
      const delivery = await db.sokoBotDelivery.findFirstOrThrow({
        where: { turnId: freshTurnId },
      });
      expect(await deliverSokoBotDelivery(delivery.id)).toBe(true);
      expect(
        await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
      ).toMatchObject({ status: "responded" });
      expect(
        await db.chatRoomMessage.findUnique({ where: { id: m.response.id } }),
      ).toMatchObject({ content: "Three invoices are due." });
    },
  );

  it("never shows Thinking again when the turn it found running ends before the dispatch goes on", async () => {
    const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
    const mountRetry = (
      await import(
        "@/routes/v1/chats/rooms/[id]/messages/[messageId]/mentions/[mentionId]/retry/post"
      )
    ).default;
    const { deliverSokoBotDelivery } = await import(
      "./soko-bot-delivery.service"
    );
    const { dispatchChatRoomMention } = await import(
      "./chat-room-coworker-dispatch.service"
    );
    const app = new OpenAPIHonoWithAuth();
    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId,
        organizationId: null,
        role: "user",
      } as never);
      return next();
    });
    mountRetry(app);

    // A running turn holds the mention; its reply shows its progress.
    const m = await staleMention();
    const turn = await db.sokoBotTurn.create({
      data: {
        sokoBotId: botId,
        requestedByUserId: userId,
        workspaceId,
        source: "CHAT",
        status: "RUNNING",
        clientTurnId: `chat:${m.mention.id}`,
        userMessage: "What is due today?",
        chatMentionId: m.mention.id,
        chatResponseMessageId: m.response.id,
        capabilityNames: [],
        deadlineAt: new Date(Date.now() + 60_000),
        destinationRoomId: roomId,
        destinationAudience: {
          userIds: [userId],
          coworkerIds: [],
          botIds: [botId],
        },
      },
    });
    await db.chatRoomMessage.update({
      where: { id: m.response.id },
      data: { metadata: { mention_id: m.mention.id, streaming: true } },
    });
    const reply = async () =>
      (
        await db.chatRoomMessage.findUniqueOrThrow({
          where: { id: m.response.id },
        })
      ).metadata as Record<string, unknown>;

    // Room events after the turn ended, each the snapshot read at publish.
    let ended = false;
    const events: Record<string, unknown>[] = [];
    publish.mockImplementation(async (id: string) => {
      if (ended && id === m.response.id) events.push(await reply());
    });

    // Barrier on the stale dispatch's lookup: it sees the turn RUNNING, then,
    // before it goes on, the turn fails, its delivery writes the failed card
    // and fails to publish (PERSISTED), and the user retries (the turn keeps
    // the mention: its publication is owed). Retry's own dispatch waits.
    const realFindMany = db.sokoBotTurn.findMany.bind(db.sokoBotTurn);
    let lookups = 0;
    let releaseRetryDispatch!: () => void;
    const retryDispatchHeld = new Promise<void>((resolve) => {
      releaseRetryDispatch = resolve;
    });
    const lookup = vi
      .spyOn(db.sokoBotTurn, "findMany")
      .mockImplementation((async (args: never) => {
        lookups += 1;
        if (lookups > 1) {
          await retryDispatchHeld;
          return realFindMany(args);
        }
        const found = await realFindMany(args);
        await db.sokoBotTurn.update({
          where: { id: turn.id },
          data: { status: "FAILED", errorDetail: "Gateway refused" },
        });
        await db.$transaction((tx) => enqueue(tx, turn.id));
        const delivery = await db.sokoBotDelivery.findFirstOrThrow({
          where: { turnId: turn.id },
        });
        publish.mockRejectedValueOnce(new Error("Ably invalid key"));
        expect(await deliverSokoBotDelivery(delivery.id)).toBe(false);
        expect(
          await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
        ).toMatchObject({ status: "PERSISTED" });
        ended = true;
        background.length = 0;
        const retried = await app.request(
          `/${roomId}/messages/${m.source.id}/mentions/${m.mention.id}/retry`,
          { method: "POST" },
        );
        expect(retried.status).toBe(200);
        return found;
      }) as never);

    // What a concurrent publisher of the owed delivery reads while the stale
    // dispatch is still going, sent only after everything else.
    let delayed: Record<string, unknown> | undefined;
    startTurn.mockImplementation(async () => {
      delayed = await reply();
      return { turnId: turn.id, status: "FAILED", duplicate: true };
    });

    try {
      await dispatchChatRoomMention(m.mention.id);
      releaseRetryDispatch();
      await Promise.all(background);
    } finally {
      lookup.mockRestore();
    }

    // Retry's own dispatch either claimed in time and waited at its lookup,
    // or found the mention failed again; both end on the failed card.
    expect(delayed).toMatchObject({ mention_failed: true });
    expect(delayed?.streaming).toBeUndefined();
    expect(events.some((event) => event.streaming === true)).toBe(false);
    // The client keeps the last full event for a message id.
    const shown = [...events, delayed].at(-1);
    expect(shown).toMatchObject({ mention_failed: true });
    expect(await reply()).toMatchObject({ mention_failed: true });
    expect(
      await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
    ).toMatchObject({ status: "failed" });
    expect(
      await db.sokoBotTurn.findUnique({ where: { id: turn.id } }),
    ).toMatchObject({ chatMentionId: m.mention.id });
  });

  // ---- review 5: ownership, Retry budget and event order ----

  function gate() {
    let reached!: () => void;
    let release!: () => void;
    const atHold = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { reached, atHold, release, released };
  }

  async function publicDispatch(mentionId: string) {
    const { dispatchChatRoomMention } = await import(
      "./chat-room-coworker-dispatch.service"
    );
    await dispatchChatRoomMention(mentionId);
  }

  async function retryRoute(m: {
    source: { id: string };
    mention: { id: string };
  }) {
    const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
    const mountRetry = (
      await import(
        "@/routes/v1/chats/rooms/[id]/messages/[messageId]/mentions/[mentionId]/retry/post"
      )
    ).default;
    const app = new OpenAPIHonoWithAuth();
    app.use("*", async (c, next) => {
      c.set("isAuthenticated", true);
      c.set("authContext", {
        actor: "user",
        userId,
        organizationId: null,
        role: "user",
      } as never);
      return next();
    });
    mountRetry(app);
    background.length = 0;
    const response = await app.request(
      `/${roomId}/messages/${m.source.id}/mentions/${m.mention.id}/retry`,
      { method: "POST" },
    );
    await Promise.all(background);
    return response.status;
  }

  /** A start that inserts its turn on the mention and leaves it running. */
  function startsRunningTurn(
    mentionId: string,
    replyId: () => Promise<string>,
  ) {
    const started: string[] = [];
    startTurn.mockImplementation(async (start: { clientTurnId: string }) => {
      const turn = await db.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          requestedByUserId: userId,
          workspaceId,
          source: "CHAT",
          status: "RUNNING",
          clientTurnId: start.clientTurnId,
          userMessage: "What is due today?",
          chatMentionId: mentionId,
          chatResponseMessageId: await replyId(),
          capabilityNames: [],
          deadlineAt: new Date(Date.now() + 60_000),
          destinationRoomId: roomId,
          destinationAudience: {
            userIds: [userId],
            coworkerIds: [],
            botIds: [botId],
          },
        },
      });
      started.push(turn.id);
      return { turnId: turn.id, status: "RUNNING", duplicate: false };
    });
    return started;
  }

  async function mentionReply(mentionId: string) {
    const mention = await db.chatRoomMention.findUniqueOrThrow({
      where: { id: mentionId },
    });
    if (!mention.responseMessageId) throw new Error("no reply opened");
    return mention.responseMessageId;
  }

  /** Completes a turn and lands its answer through the real delivery. */
  async function completeAndDeliver(turnId: string, answer: string) {
    const { deliverSokoBotDelivery } = await import(
      "./soko-bot-delivery.service"
    );
    await db.sokoBotTurn.update({
      where: { id: turnId },
      data: { status: "COMPLETED", finalAnswer: answer },
    });
    await db.$transaction((tx) => enqueue(tx, turnId));
    const delivery = await db.sokoBotDelivery.findFirstOrThrow({
      where: { turnId },
    });
    return deliverSokoBotDelivery(delivery.id);
  }

  async function mentionState(mentionId: string) {
    const mention = await db.chatRoomMention.findUniqueOrThrow({
      where: { id: mentionId },
      include: { responseMessage: true },
    });
    return {
      status: mention.status,
      content: mention.responseMessage?.content,
      metadata: (mention.responseMessage?.metadata ?? {}) as Record<
        string,
        unknown
      >,
    };
  }

  /** A new message mentioning the bot, not yet dispatched. */
  async function pendingMention() {
    const source = await db.chatRoomMessage.create({
      data: { roomId, senderUserId: userId, content: "What is due today?" },
    });
    const mention = await db.chatRoomMention.create({
      data: { messageId: source.id, sokoBotId: botId, status: "pending" },
    });
    return { source, mention };
  }

  it.each([
    { fault: "delivery lookup" as const },
    { fault: "answer restore" as const },
  ])(
    "keeps a completed turn's answer when settling it hits a $fault failure",
    async ({ fault }) => {
      const m = await staleMention();
      const turn = await turnFor(m, "COMPLETED");
      const delivery = await db.sokoBotDelivery.findFirstOrThrow({
        where: { turnId: turn.id },
      });
      const spy =
        fault === "delivery lookup"
          ? vi
              .spyOn(db.sokoBotDelivery, "findFirst")
              .mockRejectedValueOnce(new Error("connection reset"))
          : vi
              .spyOn(db, "$transaction")
              .mockRejectedValueOnce(
                new Error("Transaction API error: timeout"),
              );
      if (fault === "answer restore")
        // Backoff: the push does nothing, so the answer has to be restored here.
        await db.sokoBotDelivery.update({
          where: { id: delivery.id },
          data: { nextAttemptAt: new Date(Date.now() + 60_000) },
        });
      let faulted = 0;
      try {
        await publicDispatch(m.mention.id);
        faulted = spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
      expect(faulted).toBeGreaterThan(0);
      // Nothing failed: the mention waits for the answer.
      const waiting = await mentionState(m.mention.id);
      expect(waiting.status).toBe("sent");
      expect(waiting.metadata.mention_failed).toBeUndefined();

      const { deliverSokoBotDelivery } = await import(
        "./soko-bot-delivery.service"
      );
      await db.sokoBotDelivery.update({
        where: { id: delivery.id },
        data: { nextAttemptAt: new Date(0) },
      });
      expect(await deliverSokoBotDelivery(delivery.id)).toBe(true);
      expect(await mentionState(m.mention.id)).toMatchObject({
        status: "responded",
        content: "Two invoices are due.",
      });
    },
  );

  it("lets a worker failing before its claim leave the attempt another worker started alone", async () => {
    const m = await pendingMention();
    // Worker A loaded the pending mention, then waits in its workspace
    // lookup, which then fails.
    const a = gate();
    hold.workspace = async () => {
      a.reached();
      await a.released;
      throw new Error("workspace lookup failed");
    };
    const workerA = publicDispatch(m.mention.id);
    await a.atHold;

    // Worker B claims, opens the reply and starts the turn.
    const started = startsRunningTurn(m.mention.id, () =>
      mentionReply(m.mention.id),
    );
    await publicDispatch(m.mention.id);
    expect(started).toHaveLength(1);

    a.release();
    await workerA;
    const running = await mentionState(m.mention.id);
    expect(running.status).toBe("sent");
    expect(running.metadata).toMatchObject({ streaming: true });
    expect(running.metadata.mention_failed).toBeUndefined();

    expect(
      await completeAndDeliver(started[0], "Three invoices are due."),
    ).toBe(true);
    expect(await mentionState(m.mention.id)).toMatchObject({
      status: "responded",
      content: "Three invoices are due.",
    });
  });

  it.each([{ reclaimerStarts: true }, { reclaimerStarts: false }])(
    "lets a stale worker resuming with a setup error leave the reclaimer's attempt alone (reclaimer starts its turn: $reclaimerStarts)",
    async ({ reclaimerStarts }) => {
      const m = await pendingMention();
      // Worker A claims, opens the reply, then stalls reading the room.
      const a = gate();
      hold.context = async () => {
        a.reached();
        await a.released;
        throw new Error("room read failed");
      };
      const workerA = publicDispatch(m.mention.id);
      await a.atHold;
      // A stalls past the stale window; worker B reclaims under the same key.
      await db.$executeRaw`UPDATE chat_room_mention SET "updatedAt" = now() - interval '1 hour' WHERE id = ${m.mention.id}::uuid`;
      const started = reclaimerStarts
        ? startsRunningTurn(m.mention.id, () => mentionReply(m.mention.id))
        : [];
      if (!reclaimerStarts)
        startTurn.mockResolvedValue({ turnId: randomUUID(), status: "QUEUED" });
      await publicDispatch(m.mention.id);
      expect(startTurn.mock.calls.map(([start]) => start.clientTurnId)).toEqual(
        [`chat:${m.mention.id}`],
      );

      a.release();
      await workerA;
      const after = await mentionState(m.mention.id);
      expect(after.status).toBe("sent");
      expect(after.metadata).toMatchObject({ streaming: true });
      expect(after.metadata.mention_failed).toBeUndefined();

      if (reclaimerStarts) {
        expect(
          await completeAndDeliver(started[0], "Three invoices are due."),
        ).toBe(true);
        expect(await mentionState(m.mention.id)).toMatchObject({
          status: "responded",
          content: "Three invoices are due.",
        });
      }
    },
  );

  it("gives an explicit Retry of an old failure a fresh budget, and still gives up a stale old attempt", async () => {
    const { deliverSokoBotDelivery } = await import(
      "./soko-bot-delivery.service"
    );
    const m = await staleMention();
    const old = await turnFor(m, "FAILED");
    // Asked, and failed, 20 minutes ago.
    await db.$executeRaw`UPDATE chat_room_mention SET "createdAt" = now() - interval '20 minutes' WHERE id = ${m.mention.id}::uuid`;
    const delivery = await db.sokoBotDelivery.findFirstOrThrow({
      where: { turnId: old.id },
    });
    expect(await deliverSokoBotDelivery(delivery.id)).toBe(true);
    expect((await mentionState(m.mention.id)).status).toBe("failed");

    const started = startsRunningTurn(m.mention.id, async () => m.response.id);
    expect(await retryRoute(m)).toBe(200);
    expect(startTurn.mock.calls.map(([start]) => start.clientTurnId)).toEqual([
      `chat:${m.mention.id}:retry:${old.id}`,
    ]);
    const retried = await mentionState(m.mention.id);
    expect(retried.status).toBe("sent");
    expect(retried.metadata).toMatchObject({ streaming: true });
    expect(
      await completeAndDeliver(started[0], "Three invoices are due."),
    ).toBe(true);
    expect(await mentionState(m.mention.id)).toMatchObject({
      status: "responded",
      content: "Three invoices are due.",
    });

    // An attempt that started 20 minutes ago and keeps being reclaimed
    // without a turn is still given up.
    const stuck = await pendingMention();
    const reply = await db.chatRoomMessage.create({
      data: {
        roomId,
        senderSokoBotId: botId,
        content: "",
        metadata: {
          streaming: true,
          soko_bot: { attempt_at: Date.now() - 20 * 60_000 },
        },
      },
    });
    await db.chatRoomMention.update({
      where: { id: stuck.mention.id },
      data: { status: "sent", responseMessageId: reply.id },
    });
    await db.$executeRaw`UPDATE chat_room_mention SET "updatedAt" = now() - interval '1 hour', "createdAt" = now() - interval '20 minutes' WHERE id = ${stuck.mention.id}::uuid`;
    startTurn.mockClear();
    await publicDispatch(stuck.mention.id);
    expect(startTurn).not.toHaveBeenCalled();
    expect(
      await db.chatRoomMention.findUnique({ where: { id: stuck.mention.id } }),
    ).toMatchObject({
      status: "failed",
      error: "Soko Bot never picked this up; ask again",
    });
  });

  it("orders every published copy of a reply by attempt, so no delayed copy can replace a newer one", async () => {
    // Every full event the room receives for the reply, as published.
    const copies: Record<string, unknown>[] = [];
    const m = await pendingMention();
    publish.mockImplementation(async (id: string) => {
      const reply = await db.chatRoomMention.findUnique({
        where: { id: m.mention.id },
        select: { responseMessageId: true },
      });
      if (reply?.responseMessageId !== id) return;
      const message = await db.chatRoomMessage.findUniqueOrThrow({
        where: { id },
      });
      copies.push({
        ...(message.metadata as Record<string, unknown>),
        content: message.content,
      });
    });
    // Same comparison as Web's `isStaleSokoBotReply`.
    const order = (copy: Record<string, unknown>) => {
      const at = (copy.soko_bot as { attempt_at?: unknown } | undefined)
        ?.attempt_at;
      expect(typeof at).toBe("number");
      return [at as number, copy.streaming === true ? 0 : 1] as const;
    };
    const older = (a: readonly number[], b: readonly number[]) =>
      a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

    // Attempt 1: opens, runs, fails; its publication lands.
    const first = startsRunningTurn(m.mention.id, () =>
      mentionReply(m.mention.id),
    );
    await publicDispatch(m.mention.id);
    const { deliverSokoBotDelivery } = await import(
      "./soko-bot-delivery.service"
    );
    await db.sokoBotTurn.update({
      where: { id: first[0] },
      data: { status: "FAILED", errorDetail: "Gateway refused" },
    });
    await db.$transaction((tx) => enqueue(tx, first[0]));
    const failedDelivery = await db.sokoBotDelivery.findFirstOrThrow({
      where: { turnId: first[0] },
    });
    expect(await deliverSokoBotDelivery(failedDelivery.id)).toBe(true);
    const thinking1 = copies.find((copy) => copy.streaming === true);
    const failed1 = copies.at(-1);
    expect(failed1).toMatchObject({ mention_failed: true });

    // Attempt 2: explicit Retry, runs, answers.
    copies.length = 0;
    const second = startsRunningTurn(m.mention.id, () =>
      mentionReply(m.mention.id),
    );
    // Retry needs the reply authored by this user's mention source.
    expect(await retryRoute({ source: m.source, mention: m.mention })).toBe(
      200,
    );
    const thinking2 = copies.find((copy) => copy.streaming === true);
    expect(await completeAndDeliver(second[0], "Three invoices are due.")).toBe(
      true,
    );
    const answered2 = copies.at(-1);
    expect(answered2).toMatchObject({ content: "Three invoices are due." });

    if (!thinking1 || !failed1 || !thinking2 || !answered2)
      throw new Error("missing copy");
    // A delayed "Thinking…" from before the failure loses to the failed card.
    expect(older(order(thinking1), order(failed1))).toBe(true);
    // A fresh Retry's "Thinking…" replaces the failed card.
    expect(older(order(failed1), order(thinking2))).toBe(true);
    // A delayed old failed card loses to the fresh answer and its Thinking.
    expect(older(order(failed1), order(answered2))).toBe(true);
    expect(older(order(thinking2), order(answered2))).toBe(true);
  });

  // ---- review 6: fenced reply open and fenced turn writes ----

  /** Every Soko Bot message opened for this mention's source. */
  async function repliesFor(mentionId: string) {
    const rows = await db.chatRoomMessage.findMany({
      where: { roomId, senderSokoBotId: botId },
    });
    return rows.filter(
      (row) =>
        (row.metadata as { mention_id?: string } | null)?.mention_id ===
        mentionId,
    );
  }

  it.each([{ reclaimerStarts: true }, { reclaimerStarts: false }])(
    "lets a stale worker resuming before it opens the reply neither take it nor rewind its stamp (reclaimer starts its turn: $reclaimerStarts)",
    async ({ reclaimerStarts }) => {
      const m = await pendingMention();
      // Worker A claims, reads no turn, then stalls before opening the reply.
      const a = gate();
      const realFindMany = db.sokoBotTurn.findMany.bind(db.sokoBotTurn);
      const lookup = vi
        .spyOn(db.sokoBotTurn, "findMany")
        .mockImplementationOnce((async (args: never) => {
          const found = await realFindMany(args);
          a.reached();
          await a.released;
          return found;
        }) as never);
      const workerA = publicDispatch(m.mention.id);
      await a.atHold;
      // A stalls past the stale window; worker B reclaims and opens its reply.
      await db.$executeRaw`UPDATE chat_room_mention SET "updatedAt" = now() - interval '1 hour' WHERE id = ${m.mention.id}::uuid`;
      const started = reclaimerStarts
        ? startsRunningTurn(m.mention.id, () => mentionReply(m.mention.id))
        : [];
      if (!reclaimerStarts)
        startTurn.mockResolvedValue({ turnId: randomUUID(), status: "QUEUED" });
      await publicDispatch(m.mention.id);
      const afterB = await db.chatRoomMention.findUniqueOrThrow({
        where: { id: m.mention.id },
      });
      expect(afterB.responseMessageId).not.toBeNull();

      a.release();
      try {
        await workerA;
      } finally {
        lookup.mockRestore();
      }
      // A wrote nothing: B's reply stays linked, B's stamp stays, one reply.
      const afterA = await db.chatRoomMention.findUniqueOrThrow({
        where: { id: m.mention.id },
      });
      expect(afterA.responseMessageId).toBe(afterB.responseMessageId);
      expect(afterA.updatedAt.getTime()).toBe(afterB.updatedAt.getTime());
      expect(afterA.status).toBe("sent");
      expect(await repliesFor(m.mention.id)).toHaveLength(1);
      expect(startTurn).toHaveBeenCalledTimes(1);

      if (reclaimerStarts) {
        expect(
          await completeAndDeliver(started[0], "Three invoices are due."),
        ).toBe(true);
        expect(await mentionState(m.mention.id)).toMatchObject({
          status: "responded",
          content: "Three invoices are due.",
        });
        // No reply left "Thinking…".
        const replies = await repliesFor(m.mention.id);
        expect(
          replies.filter(
            (row) =>
              (row.metadata as { streaming?: boolean }).streaming === true,
          ),
        ).toEqual([]);
      }
    },
  );

  it("keeps a fresh Retry's answer visible when the old turn's progress lands late", async () => {
    const { isStaleSokoBotReply, readSokoBotAttemptAt } = await import(
      "@sokosumi/utils"
    );
    const { publishSokoBotChatProgress } = await import(
      "./soko-bot-chat.service"
    );
    const { deliverSokoBotDelivery } = await import(
      "./soko-bot-delivery.service"
    );
    const m = await pendingMention();
    // Every full copy of the reply the room receives, read when published.
    const copies: { metadata: unknown; content: string }[] = [];
    publish.mockImplementation(async (id: string) => {
      const link = await db.chatRoomMention.findUnique({
        where: { id: m.mention.id },
        select: { responseMessageId: true },
      });
      if (link?.responseMessageId !== id) return;
      const row = await db.chatRoomMessage.findUniqueOrThrow({ where: { id } });
      copies.push({ metadata: row.metadata, content: row.content });
    });

    // Attempt 1 runs.
    const first = startsRunningTurn(m.mention.id, () =>
      mentionReply(m.mention.id),
    );
    await publicDispatch(m.mention.id);
    const replyId = await mentionReply(m.mention.id);
    const attempt1 = readSokoBotAttemptAt(
      (await db.chatRoomMessage.findUniqueOrThrow({ where: { id: replyId } }))
        .metadata,
    );

    // Its progress write is delayed at its transaction.
    const realTx = db.$transaction.bind(db) as typeof db.$transaction;
    const p = gate();
    const delayed = vi.spyOn(db, "$transaction").mockImplementationOnce((async (
      ...args: never[]
    ) => {
      p.reached();
      await p.released;
      return (realTx as (...a: never[]) => unknown)(...args);
    }) as never);
    const oldProgress = publishSokoBotChatProgress(first[0]);
    await p.atHold;

    // Meanwhile attempt 1 fails and is delivered; the user retries.
    await db.sokoBotTurn.update({
      where: { id: first[0] },
      data: { status: "FAILED", errorDetail: "Gateway refused" },
    });
    await db.$transaction((tx) => enqueue(tx, first[0]));
    const failedDelivery = await db.sokoBotDelivery.findFirstOrThrow({
      where: { turnId: first[0] },
    });
    expect(await deliverSokoBotDelivery(failedDelivery.id)).toBe(true);
    const second = startsRunningTurn(m.mention.id, () =>
      mentionReply(m.mention.id),
    );
    expect(await retryRoute(m)).toBe(200);
    expect(second).toHaveLength(1);
    const attempt2 = readSokoBotAttemptAt(
      (await db.chatRoomMessage.findUniqueOrThrow({ where: { id: replyId } }))
        .metadata,
    );

    // The old progress lands now.
    p.release();
    try {
      await oldProgress;
    } finally {
      delayed.mockRestore();
    }
    const afterOld = await db.chatRoomMessage.findUniqueOrThrow({
      where: { id: replyId },
    });
    expect(readSokoBotAttemptAt(afterOld.metadata)).toBe(attempt2);
    expect(
      (afterOld.metadata as { soko_bot?: { turn_id?: string } }).soko_bot
        ?.turn_id,
    ).not.toBe(first[0]);

    // The fresh turn answers through the real outbox.
    expect(await completeAndDeliver(second[0], "Three invoices are due.")).toBe(
      true,
    );
    const answered = await db.chatRoomMessage.findUniqueOrThrow({
      where: { id: replyId },
    });
    expect(answered.content).toBe("Three invoices are due.");
    expect(readSokoBotAttemptAt(answered.metadata)).toBe(attempt2);
    expect(attempt2).toBeGreaterThan(attempt1 as number);

    // The attempt carried by the reply never went down, copy by copy.
    const stamps = copies.map((copy) => readSokoBotAttemptAt(copy.metadata));
    expect(stamps.every((at) => typeof at === "number")).toBe(true);
    for (let i = 1; i < stamps.length; i++)
      expect(stamps[i] as number).toBeGreaterThanOrEqual(
        stamps[i - 1] as number,
      );
    // Web's decision (`isStaleSokoBotReply`, used by mergeRoomMessages) over
    // the copies in order, and again with the old attempt's copies arriving
    // last: the answer stays shown.
    const show = (order: typeof copies) =>
      order.reduce<(typeof copies)[number] | undefined>(
        (shown, copy) =>
          shown && isStaleSokoBotReply(shown.metadata, copy.metadata)
            ? shown
            : copy,
        undefined,
      );
    expect(show(copies)?.content).toBe("Three invoices are due.");
    const old = copies.filter(
      (copy) => readSokoBotAttemptAt(copy.metadata) === attempt1,
    );
    expect(old.length).toBeGreaterThan(0);
    expect(show([...copies, ...old])?.content).toBe("Three invoices are due.");
  });
});
