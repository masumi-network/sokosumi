import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { publish, invalidate, humanNotify } = vi.hoisted(() => ({
  humanNotify: vi.fn(),
  publish: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: publish,
}));
vi.mock("@/helpers/chat-room-message-created-effects", () => ({
  invalidateChatRoomMessageReaders: invalidate,
}));
vi.mock("@/helpers/chat-mention-notifications", () => ({
  emitChatMentionNotifications: humanNotify,
}));
vi.mock("@/helpers/chat-direct-message-notifications", () => ({
  emitChatDirectMessageNotifications: vi.fn(),
  shouldEmitChatDirectMessageNotifications: () => false,
}));
vi.mock("@/lib/db/prisma", async () => {
  const { createPrismaClient } = await import("@sokosumi/database/client");
  const value = process.env.LOCAL_RELIABILITY_DATABASE_URL;
  if (!value) throw new Error("Explicit local reliability database required");
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    ![
      "/soko_reliability_verified",
      "/soko_reliability_integrated",
      "/soko_reliability_integrated_6e",
    ].includes(url.pathname)
  ) {
    throw new Error(
      "Only the disposable local reliability database is allowed",
    );
  }
  return { default: createPrismaClient(value) };
});

const databaseUrl = process.env.LOCAL_RELIABILITY_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "delivery transaction/crash/race integration (local only)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    let deliver: typeof import("./soko-bot-delivery.service").deliverSokoBotDelivery;
    let enqueue: typeof import("./soko-bot-delivery.service").enqueueSokoBotDelivery;
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const botId = randomUUID();
    const roomId = randomUUID();

    beforeAll(async () => {
      const module = await import("@/lib/db/prisma");
      db = module.default;
      const service = await import("./soko-bot-delivery.service");
      deliver = service.deliverSokoBotDelivery;
      enqueue = service.enqueueSokoBotDelivery;
      await db.user.create({
        data: {
          id: userId,
          name: "Delivery fixture",
          email: `delivery-${userId}@sokosumi.test`,
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
          name: "Delivery fixture",
          kind: "direct",
          directKey: `delivery:${roomId}`,
          createdByUserId: userId,
          userMembers: { create: { userId } },
          sokoBotMembers: { create: { sokoBotId: botId } },
        },
      });
    });
    afterAll(async () => {
      if (!db) return;
      await db.chatRoom.deleteMany({ where: { id: roomId } });
      await db.user.deleteMany({ where: { id: userId } });
      await db.$disconnect();
    });

    async function newDelivery(chat?: {
      mentionId: string;
      responseMessageId: string;
      chainDepth?: number;
      finalAnswer?: string;
    }) {
      const turn = await db.sokoBotTurn.create({
        data: {
          sokoBotId: botId,
          userId,
          workspaceId,
          source: chat ? "CHAT" : "SCHEDULE",
          chatMentionId: chat?.mentionId,
          chatResponseMessageId: chat?.responseMessageId,
          status: "COMPLETED",
          clientTurnId: randomUUID(),
          userMessage: "Fixture",
          finalAnswer: chat?.finalAnswer ?? "Committed result",
          chainDepth: chat?.chainDepth ?? 0,
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
      return db.sokoBotDelivery.findUniqueOrThrow({
        where: {
          turnId_destinationKind_destinationId_purpose: {
            turnId: turn.id,
            destinationKind: "CHAT_ROOM",
            destinationId: roomId,
            purpose: "FINAL",
          },
        },
      });
    }

    it("keeps distinct destinations and purposes while replaying the canonical final obligation", async () => {
      const original = await newDelivery();
      const secondRoom = await db.chatRoom.create({
        data: {
          name: "Second delivery destination",
          kind: "direct",
          directKey: randomUUID(),
          createdByUserId: userId,
          userMembers: { create: { userId } },
          sokoBotMembers: { create: { sokoBotId: botId } },
        },
      });
      try {
        const destination = await db.sokoBotDelivery.create({
          data: {
            turnId: original.turnId,
            destinationKind: "CHAT_ROOM",
            destinationId: secondRoom.id,
            roomId: secondRoom.id,
            purpose: "FINAL",
          },
        });
        const purpose = await db.sokoBotDelivery.create({
          data: {
            turnId: original.turnId,
            destinationKind: "CHAT_ROOM",
            destinationId: roomId,
            roomId,
            purpose: "FOLLOW_UP",
          },
        });
        await db.$transaction((tx) => enqueue(tx, original.turnId));
        expect(
          await db.sokoBotDelivery.count({
            where: { turnId: original.turnId },
          }),
        ).toBe(3);
        await expect(
          db.sokoBotDelivery.create({
            data: {
              turnId: original.turnId,
              destinationKind: "CHAT_ROOM",
              destinationId: roomId,
              roomId,
              purpose: "FINAL",
            },
          }),
        ).rejects.toMatchObject({ code: "P2002" });
        for (const obligation of [original, destination, purpose]) {
          expect(await deliver(obligation.id)).toBe(true);
        }
        const delivered = await db.sokoBotDelivery.findMany({
          where: { turnId: original.turnId },
        });
        expect(delivered.every((row) => row.status === "PUBLISHED")).toBe(true);
        expect(new Set(delivered.map((row) => row.messageId)).size).toBe(3);
      } finally {
        await db.chatRoom.delete({ where: { id: secondRoom.id } });
      }
    });

    async function newEffect(content = "Committed tool message") {
      const delivery = await newDelivery();
      const message = await db.chatRoomMessage.create({
        data: {
          roomId,
          senderSokoBotId: botId,
          content: "",
          deletedAt: new Date(),
        },
      });
      const receipt = await db.sokoBotToolCall.create({
        data: {
          turnId: delivery.turnId,
          toolCallId: randomUUID(),
          capability: "post_chat",
          inputHash: "fixture",
          status: "COMPLETED",
          disposition: "APPLIED",
          verification: "LOCAL_TRANSACTION",
          targetId: message.id,
        },
      });
      const { enqueueSokoBotEffect } = await import(
        "./soko-bot-effect-outbox.service"
      );
      const effect = await db.$transaction((tx) =>
        enqueueSokoBotEffect(tx, {
          receiptId: receipt.id,
          purpose: "CHAT_MESSAGE",
          payload: {
            messageId: message.id,
            content,
            roomId,
            userIds: [userId],
            coworkerIds: [],
            botIds: [botId],
          },
        }),
      );
      return { ...effect, messageId: message.id };
    }

    it("effect workers race on one committed message and retry transport without new writes", async () => {
      const { deliverSokoBotEffect } = await import(
        "./soko-bot-effect-outbox.service"
      );
      const effect = await newEffect();
      const count = await db.chatRoomMessage.count({ where: { roomId } });
      publish.mockRejectedValueOnce(new Error("crash after commit"));
      await Promise.all([
        deliverSokoBotEffect(effect.id),
        deliverSokoBotEffect(effect.id),
      ]);
      expect(
        await db.sokoBotEffectOutbox.findUnique({ where: { id: effect.id } }),
      ).toMatchObject({ status: "PERSISTED", attempts: 1 });
      await db.sokoBotEffectOutbox.update({
        where: { id: effect.id },
        data: { nextAttemptAt: new Date(0) },
      });
      publish.mockResolvedValue(undefined);
      expect(await deliverSokoBotEffect(effect.id)).toBe(true);
      expect(await db.chatRoomMessage.count({ where: { roomId } })).toBe(count);
    });

    it("activates human mentions with content and retries their durable handoff", async () => {
      const { deliverSokoBotEffect } = await import(
        "./soko-bot-effect-outbox.service"
      );
      const effect = await newEffect(`@${userId} please check`);
      expect(
        await db.chatRoomUserMention.count({
          where: { messageId: effect.messageId },
        }),
      ).toBe(0);
      humanNotify.mockRejectedValueOnce(
        new Error("notification queue unavailable"),
      );
      expect(await deliverSokoBotEffect(effect.id)).toBe(false);
      expect(
        await db.chatRoomUserMention.findMany({
          where: { messageId: effect.messageId },
        }),
      ).toEqual([
        expect.objectContaining({ userId, messageId: effect.messageId }),
      ]);
      await db.sokoBotEffectOutbox.update({
        where: { id: effect.id },
        data: { nextAttemptAt: new Date(0) },
      });
      expect(await deliverSokoBotEffect(effect.id)).toBe(true);
      expect(
        await db.chatRoomUserMention.count({
          where: { messageId: effect.messageId },
        }),
      ).toBe(1);
      expect(humanNotify).toHaveBeenLastCalledWith(
        expect.objectContaining({
          messageId: effect.messageId,
          mentionedUserIds: [userId],
          throwOnError: true,
        }),
      );
    });

    it("keeps queued content unreadable and cancels staged mentions when a new reader joins", async () => {
      const { deliverSokoBotEffect } = await import(
        "./soko-bot-effect-outbox.service"
      );
      const effect = await newEffect(`@${userId} private handoff`);
      const mention = await db.chatRoomMention.create({
        data: {
          messageId: effect.messageId,
          sokoBotId: botId,
          status: "staged",
        },
      });
      expect(
        await db.chatRoomMessage.findFirst({
          where: { id: effect.messageId, deletedAt: null },
        }),
      ).toBeNull();
      expect(
        await db.chatRoomMessage.findUnique({
          where: { id: effect.messageId },
        }),
      ).toMatchObject({ content: "" });
      const newcomer = await db.user.create({
        data: {
          name: "Later reader",
          email: `effect-reader-${randomUUID()}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const publications = publish.mock.calls.length;
      try {
        await db.chatRoomUserMember.create({
          data: { roomId, userId: newcomer.id },
        });
        expect(await deliverSokoBotEffect(effect.id)).toBe(false);
        expect(
          await db.sokoBotEffectOutbox.findUnique({ where: { id: effect.id } }),
        ).toMatchObject({
          status: "SUPPRESSED",
          reason: "AUDIENCE_CHANGED",
        });
        expect(
          await db.chatRoomMessage.findFirst({
            where: { id: effect.messageId, deletedAt: null },
          }),
        ).toBeNull();
        expect(
          await db.chatRoomMessage.findUnique({
            where: { id: effect.messageId },
          }),
        ).toMatchObject({ content: "", deletedAt: expect.any(Date) });
        expect(
          await db.chatRoomMention.findUnique({ where: { id: mention.id } }),
        ).toMatchObject({
          status: "failed",
          error: "Soko Bot delivery suppressed: AUDIENCE_CHANGED",
        });
        expect(
          await db.chatRoomUserMention.count({
            where: { messageId: effect.messageId },
          }),
        ).toBe(0);
        expect(publish.mock.calls.length).toBe(publications);
      } finally {
        await db.user.delete({ where: { id: newcomer.id } });
      }
    });

    it.each(["suppressed", "dead_letter"])(
      "raises a %s nudge again after release and backoff",
      async (failure) => {
        const delivery = await newDelivery();
        const task = await db.task.create({
          data: {
            name: "Needs attention",
            ownerId: userId,
            creatorUserId: userId,
            workspaceId,
            status: "FAILED",
          },
        });
        const event = await db.taskEvent.create({
          data: {
            taskId: task.id,
            status: "FAILED",
            createdAt: new Date(Date.now() - 2 * 60 * 60_000),
          },
        });
        await db.sokoBotDelegation.create({
          data: {
            turnId: delivery.turnId,
            toolCallId: randomUUID(),
            kind: "TASK",
            action: "create_task",
            taskId: task.id,
          },
        });
        const key = `failed:${task.id}:${event.id}`;
        const { findAttentionItems, stageSokoBotNudges } = await import(
          "./soko-bot-proactive.service"
        );
        await stageSokoBotNudges(botId, [key], new Date(), delivery.turnId);
        const input = {
          id: botId,
          workspaceId,
          followWholeBoard: false,
          now: new Date(),
        };
        expect(
          (await findAttentionItems(input)).map((item) => item.key),
        ).not.toContain(key);
        try {
          if (failure === "suppressed")
            await db.chatRoom.update({
              where: { id: roomId },
              data: { archivedAt: new Date() },
            });
          else {
            await db.sokoBotDelivery.update({
              where: { id: delivery.id },
              data: { createdAt: new Date(Date.now() - 90_000_000) },
            });
            publish.mockRejectedValueOnce(new Error("offline"));
          }
          expect(await deliver(delivery.id)).toBe(false);
          expect(
            (await findAttentionItems(input)).map((item) => item.key),
          ).not.toContain(key);
          expect(
            (
              await findAttentionItems({
                ...input,
                now: new Date(Date.now() + 120_000),
              })
            ).map((item) => item.key),
          ).toContain(key);
        } finally {
          await db.chatRoom.update({
            where: { id: roomId },
            data: { archivedAt: null },
          });
          await db.task.delete({ where: { id: task.id } });
        }
      },
    );

    it("effect obligation rolls back with its receipt transaction", async () => {
      const effect = await newEffect();
      await db.sokoBotEffectOutbox.delete({ where: { id: effect.id } });
      const { enqueueSokoBotEffect } = await import(
        "./soko-bot-effect-outbox.service"
      );
      await expect(
        db.$transaction(async (tx) => {
          await enqueueSokoBotEffect(tx, {
            receiptId: effect.receiptId,
            purpose: "CHAT_MESSAGE",
            payload: {},
          });
          throw new Error("crash before commit");
        }),
      ).rejects.toThrow("crash before commit");
      expect(
        await db.sokoBotEffectOutbox.count({
          where: { receiptId: effect.receiptId },
        }),
      ).toBe(0);
    });

    it("silent bot reply durably deletes its placeholder and publishes mention completion on retry", async () => {
      const source = await db.chatRoomMessage.create({
        data: { roomId, senderUserId: userId, content: "Bot handoff" },
      });
      const response = await db.chatRoomMessage.create({
        data: { roomId, senderSokoBotId: botId, content: "" },
      });
      const mention = await db.chatRoomMention.create({
        data: {
          messageId: source.id,
          sokoBotId: botId,
          responseMessageId: response.id,
        },
      });
      const delivery = await newDelivery({
        mentionId: mention.id,
        responseMessageId: response.id,
        chainDepth: 1,
        finalAnswer: "Nothing to add.",
      });
      expect(delivery).toMatchObject({ status: "PENDING", reason: "SILENT" });
      publish.mockRejectedValueOnce(new Error("lost delete acknowledgement"));
      expect(await deliver(delivery.id)).toBe(false);
      expect(
        await db.chatRoomMessage.findUnique({ where: { id: response.id } }),
      ).toMatchObject({ deletedAt: expect.any(Date) });
      expect(
        await db.chatRoomMention.findUnique({ where: { id: mention.id } }),
      ).toMatchObject({ status: "responded" });
      await db.sokoBotDelivery.update({
        where: { id: delivery.id },
        data: { nextAttemptAt: new Date(0) },
      });
      publish.mockResolvedValue(undefined);
      expect(await deliver(delivery.id)).toBe(true);
      expect(publish).toHaveBeenCalledWith(response.id, "delete", {
        throwOnError: true,
      });
      expect(publish).toHaveBeenCalledWith(source.id, "mention_status", {
        throwOnError: true,
      });
      expect(
        await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
      ).toMatchObject({ status: "PUBLISHED", reason: "SILENT" });
    });

    it.each(["", "Nothing to add."])(
      "ordinary owner chat does not delete its response or dead-letter for %s",
      async (finalAnswer) => {
        const source = await db.chatRoomMessage.create({
          data: { roomId, senderUserId: userId, content: "Owner question" },
        });
        const response = await db.chatRoomMessage.create({
          data: { roomId, senderSokoBotId: botId, content: "" },
        });
        const mention = await db.chatRoomMention.create({
          data: {
            messageId: source.id,
            sokoBotId: botId,
            responseMessageId: response.id,
          },
        });
        const delivery = await newDelivery({
          mentionId: mention.id,
          responseMessageId: response.id,
          chainDepth: 0,
          finalAnswer,
        });
        expect(await deliver(delivery.id)).toBe(true);
        expect(
          await db.chatRoomMessage.findUnique({ where: { id: response.id } }),
        ).toMatchObject({ deletedAt: null });
        expect(
          await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
        ).toMatchObject({ status: "PUBLISHED" });
        expect(publish).toHaveBeenCalledWith(response.id, "update", {
          throwOnError: true,
        });
      },
    );

    it("terminal suppression releases staged nudges without stamping them sent", async () => {
      const delivery = await newDelivery();
      const nudge = await db.sokoBotNudge.create({
        data: {
          sokoBotId: botId,
          key: randomUUID(),
          lastAt: new Date(),
          pendingTurnId: delivery.turnId,
        },
      });
      await db.chatRoom.update({
        where: { id: roomId },
        data: { archivedAt: new Date() },
      });
      try {
        expect(await deliver(delivery.id)).toBe(false);
        expect(
          await db.sokoBotNudge.findUnique({ where: { id: nudge.id } }),
        ).toMatchObject({
          pendingTurnId: null,
          lastDeliveredAt: null,
          nextCheckAt: expect.any(Date),
        });
        const { stageSokoBotNudges } = await import(
          "./soko-bot-proactive.service"
        );
        const laterKey = randomUUID();
        await stageSokoBotNudges(
          botId,
          [laterKey],
          new Date(),
          delivery.turnId,
        );
        expect(
          await db.sokoBotNudge.findUnique({
            where: { sokoBotId_key: { sokoBotId: botId, key: laterKey } },
          }),
        ).toMatchObject({
          pendingTurnId: null,
          lastDeliveredAt: null,
          nextCheckAt: expect.any(Date),
        });
      } finally {
        await db.chatRoom.update({
          where: { id: roomId },
          data: { archivedAt: null },
        });
      }
    });

    it("dead-letter delivery releases nudges and failed transport never stamps sent", async () => {
      const delivery = await newDelivery();
      const nudge = await db.sokoBotNudge.create({
        data: {
          sokoBotId: botId,
          key: randomUUID(),
          lastAt: new Date(),
          pendingTurnId: delivery.turnId,
        },
      });
      await db.sokoBotDelivery.update({
        where: { id: delivery.id },
        data: { createdAt: new Date(Date.now() - 90_000_000) },
      });
      publish.mockRejectedValueOnce(new Error("transport unavailable"));
      expect(await deliver(delivery.id)).toBe(false);
      expect(
        await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
      ).toMatchObject({ status: "DEAD_LETTER" });
      expect(
        await db.sokoBotNudge.findUnique({ where: { id: nudge.id } }),
      ).toMatchObject({
        pendingTurnId: null,
        lastDeliveredAt: null,
        nextCheckAt: expect.any(Date),
      });
    });

    it("rolls back the delivery obligation with settlement", async () => {
      const delivery = await newDelivery();
      await db.sokoBotDelivery.delete({ where: { id: delivery.id } });
      await expect(
        db.$transaction(async (tx) => {
          await enqueue(tx, delivery.turnId);
          throw new Error("crash before settlement commit");
        }),
      ).rejects.toThrow("crash before settlement commit");
      expect(
        await db.sokoBotDelivery.count({ where: { turnId: delivery.turnId } }),
      ).toBe(0);
    });

    it("concurrent workers persist one keyed message", async () => {
      publish.mockResolvedValue(undefined);
      const delivery = await newDelivery();
      await Promise.all([deliver(delivery.id), deliver(delivery.id)]);
      const persisted = await db.sokoBotDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      });
      expect(persisted.status).toBe("PUBLISHED");
      expect(
        await db.chatRoomMessage.count({
          where: {
            roomId,
            clientMessageId: `soko-bot:${delivery.turnId}:final`,
          },
        }),
      ).toBe(1);
    });

    it("publish failure leaves message and PERSISTED atomic; retry keeps ID and content", async () => {
      publish.mockRejectedValueOnce(new Error("crash after message commit"));
      const delivery = await newDelivery();
      expect(await deliver(delivery.id)).toBe(false);
      const persisted = await db.sokoBotDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      });
      expect(persisted.status).toBe("PERSISTED");
      expect(persisted.messageId).not.toBeNull();
      await db.sokoBotTurn.update({
        where: { id: delivery.turnId },
        data: { finalAnswer: "Must not overwrite committed output" },
      });
      await db.sokoBotDelivery.update({
        where: { id: delivery.id },
        data: { nextAttemptAt: new Date(0) },
      });
      publish.mockResolvedValue(undefined);
      expect(await deliver(delivery.id)).toBe(true);
      expect(
        await db.chatRoomMessage.findUnique({
          where: { id: persisted.messageId ?? "" },
        }),
      ).toMatchObject({ content: "Committed result" });
    });

    it("crash after publish replays the same message ID", async () => {
      const delivery = await newDelivery();
      publish.mockResolvedValue(undefined);
      await deliver(delivery.id);
      const first = await db.sokoBotDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      });
      // Simulate transport acknowledgement arriving before the final DB write.
      await db.sokoBotDelivery.update({
        where: { id: delivery.id },
        data: { status: "PERSISTED", publishedAt: null },
      });
      publish.mockClear();
      await deliver(delivery.id);
      expect(publish).toHaveBeenCalledWith(first.messageId, "create", {
        throwOnError: true,
      });
      expect(
        await db.chatRoomMessage.count({
          where: {
            roomId,
            clientMessageId: `soko-bot:${delivery.turnId}:final`,
          },
        }),
      ).toBe(1);
    });

    it("expired lease can be reclaimed but an active competing lease cannot", async () => {
      const delivery = await newDelivery();
      await db.sokoBotDelivery.update({
        where: { id: delivery.id },
        data: {
          leaseToken: "older-worker",
          leaseUntil: new Date(Date.now() + 60_000),
        },
      });
      expect(await deliver(delivery.id)).toBe(false);
      await db.sokoBotDelivery.update({
        where: { id: delivery.id },
        data: { leaseUntil: new Date(0) },
      });
      expect(await deliver(delivery.id)).toBe(true);
      expect(
        await db.sokoBotDelivery.updateMany({
          where: { id: delivery.id, leaseToken: "older-worker" },
          data: { status: "PENDING" },
        }),
      ).toEqual({ count: 0 });
    });

    it("CHAT delivery updates the existing response and retries it without duplication", async () => {
      const source = await db.chatRoomMessage.create({
        data: { roomId, senderUserId: userId, content: "Hello" },
      });
      const response = await db.chatRoomMessage.create({
        data: { roomId, senderSokoBotId: botId, content: "" },
      });
      const mention = await db.chatRoomMention.create({
        data: {
          messageId: source.id,
          sokoBotId: botId,
          responseMessageId: response.id,
        },
      });
      const delivery = await newDelivery({
        mentionId: mention.id,
        responseMessageId: response.id,
      });
      publish.mockRejectedValueOnce(new Error("offline"));
      await deliver(delivery.id);
      expect(
        await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
      ).toMatchObject({ status: "PERSISTED", messageId: response.id });
      expect(
        await db.chatRoomMessage.findUnique({ where: { id: response.id } }),
      ).toMatchObject({ content: "Committed result" });
      const count = await db.chatRoomMessage.count({ where: { roomId } });
      await db.sokoBotDelivery.update({
        where: { id: delivery.id },
        data: { nextAttemptAt: new Date(0) },
      });
      publish.mockResolvedValue(undefined);
      await deliver(delivery.id);
      expect(await db.chatRoomMessage.count({ where: { roomId } })).toBe(count);
      expect(
        await db.chatRoomMention.findUnique({ where: { id: mention.id } }),
      ).toMatchObject({ status: "responded" });
    });

    it("suppresses pending output when a reader joins after audience capture", async () => {
      const delivery = await newDelivery();
      const newcomer = await db.user.create({
        data: {
          name: "Later reader",
          email: `reader-${randomUUID()}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const publications = publish.mock.calls.length;
      try {
        await db.chatRoomUserMember.create({
          data: { roomId, userId: newcomer.id },
        });
        expect(await deliver(delivery.id)).toBe(false);
        expect(
          await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
        ).toMatchObject({
          status: "SUPPRESSED",
          reason: "DESTINATION_REVOKED",
          messageId: null,
        });
        expect(publish.mock.calls.length).toBe(publications);
      } finally {
        await db.user.delete({ where: { id: newcomer.id } });
      }
    });

    it("revoked owner membership suppresses pending output", async () => {
      const delivery = await newDelivery();
      await db.chatRoomUserMember.deleteMany({ where: { roomId, userId } });
      try {
        expect(await deliver(delivery.id)).toBe(false);
        expect(
          await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
        ).toMatchObject({ status: "SUPPRESSED", messageId: null });
      } finally {
        await db.chatRoomUserMember.create({ data: { roomId, userId } });
      }
    });

    it("archived destination is suppressed without fallback", async () => {
      const delivery = await newDelivery();
      await db.chatRoom.update({
        where: { id: roomId },
        data: { archivedAt: new Date() },
      });
      try {
        expect(await deliver(delivery.id)).toBe(false);
        expect(
          await db.sokoBotDelivery.findUnique({ where: { id: delivery.id } }),
        ).toMatchObject({
          status: "SUPPRESSED",
          reason: "DESTINATION_REVOKED",
          messageId: null,
        });
      } finally {
        await db.chatRoom.update({
          where: { id: roomId },
          data: { archivedAt: null },
        });
      }
    });
  },
);
