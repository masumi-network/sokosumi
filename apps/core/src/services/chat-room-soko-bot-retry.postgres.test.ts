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
 *   fresh turn under one stable key.
 */

const { startTurn, publish, background } = vi.hoisted(() => ({
  startTurn: vi.fn(),
  publish: vi.fn(),
  background: [] as Promise<unknown>[],
}));
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

    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn.mock.calls[0][0].clientTurnId).toBe(
      `chat:${m.mention.id}`,
    );
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

    // Retry while the publication is still owed: the old turn keeps the
    // mention, and the reply ends failed again, never "Thinking…".
    expect(await retry()).toBe(200);
    expect(startTurn.mock.calls.map(([start]) => start.clientTurnId)).toEqual([
      `chat:${m.mention.id}`,
    ]);
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

    // Now Retry lets go of the old turn and starts a fresh one.
    startTurn.mockClear();
    expect(await retry()).toBe(200);
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
});
