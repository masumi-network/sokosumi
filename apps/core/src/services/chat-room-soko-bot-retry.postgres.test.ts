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

const { startTurn, publish, background, afterOutboxPush } = vi.hoisted(() => ({
  startTurn: vi.fn(),
  publish: vi.fn(),
  background: [] as Promise<unknown>[],
  // Where a dispatch settling an ended turn waits once that turn's delivery
  // push returned, before it puts the outcome back on the reply.
  afterOutboxPush: { current: null as null | (() => Promise<void>) },
}));
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

  it("lets a worker that could not open the reply fail it only while no reclaim took over", async () => {
    const { claimMentionForDispatch, failSokoBotReplyIfOwned } = await import(
      "./chat-room-mention-state"
    );
    const m = await staleMention();
    await db.chatRoomMention.update({
      where: { id: m.mention.id },
      data: { responseMessageId: null },
    });
    await db.$executeRaw`UPDATE chat_room_mention SET "updatedAt" = now() - interval '1 hour' WHERE id = ${m.mention.id}::uuid`;
    const stampNow = async () =>
      (
        await db.chatRoomMention.findUniqueOrThrow({
          where: { id: m.mention.id },
        })
      ).updatedAt;
    const fail = (stamp: Date) =>
      failSokoBotReplyIfOwned({
        mentionId: m.mention.id,
        clientTurnId: `chat:${m.mention.id}`,
        replyId: null,
        stamp,
        sourceMessageId: m.source.id,
        error: "Could not open the reply",
      });

    // Worker A claims, cannot open the reply, and stalls past the stale
    // window; worker B reclaims the same attempt key.
    expect(await claimMentionForDispatch(m.mention.id)).toBe(true);
    const stale = await stampNow();
    await db.$executeRaw`UPDATE chat_room_mention SET "updatedAt" = now() - interval '1 hour' WHERE id = ${m.mention.id}::uuid`;
    expect(await claimMentionForDispatch(m.mention.id)).toBe(true);
    const current = await stampNow();

    expect(await fail(stale)).toBe(false);
    expect(
      await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
    ).toMatchObject({ status: "sent" });
    expect(await fail(current)).toBe(false);
    expect(
      await db.chatRoomMention.findUnique({ where: { id: m.mention.id } }),
    ).toMatchObject({ status: "failed", error: "Could not open the reply" });
  });
});
