import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import { isSokoBotSilentAnswer } from "@sokosumi/soko-bot";
import { z } from "zod";
import { invalidateChatRoomMessageReaders } from "@/helpers/chat-room-message-created-effects";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { persistSokoBotChatTurn } from "./soko-bot-chat.service";
import { deliverSokoBotEffect } from "./soko-bot-effect-outbox.service";

const audienceSchema = z.object({
  userIds: z.array(z.string()),
  coworkerIds: z.array(z.string()),
  botIds: z.array(z.string()),
});

const LEASE_MS = 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000];

/** Called inside the settlement transaction; no historical turn backfill. */
export async function enqueueSokoBotDelivery(
  tx: Prisma.TransactionClient,
  turnId: string,
): Promise<void> {
  const turn = await tx.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
  });
  const isChat = turn.source === "CHAT" && turn.chatResponseMessageId !== null;
  const silent =
    turn.status === "COMPLETED" &&
    isSokoBotSilentAnswer(turn.finalAnswer?.trim() ?? "") &&
    (!isChat || turn.chainDepth > 0);
  const reason =
    turn.source === "CHAT" && !isChat
      ? "ASSISTANT_PAGE"
      : !turn.destinationRoomId
        ? "NO_DESTINATION"
        : silent
          ? "SILENT"
          : !isChat && turn.status !== "COMPLETED"
            ? turn.status
            : null;
  await tx.sokoBotDelivery.upsert({
    where: {
      turnId_destinationKind_destinationId_purpose: {
        turnId,
        destinationKind: "CHAT_ROOM",
        destinationId: turn.destinationRoomId ?? "NONE",
        purpose: "FINAL",
      },
    },
    create: {
      turnId,
      roomId: turn.destinationRoomId,
      destinationId: turn.destinationRoomId ?? "NONE",
      status:
        reason && !(silent && isChat && turn.destinationRoomId)
          ? "SUPPRESSED"
          : "PENDING",
      reason,
    },
    update: {},
  });
  if (reason && !(silent && isChat && turn.destinationRoomId)) {
    await releasePendingNudges(tx, turnId);
  }
}

async function releasePendingNudges(
  tx: Prisma.TransactionClient,
  turnId: string,
) {
  await tx.sokoBotNudge.updateMany({
    where: { pendingTurnId: turnId },
    data: { pendingTurnId: null, nextCheckAt: new Date(Date.now() + 60_000) },
  });
}

async function destinationStillAuthorized(
  tx: Prisma.TransactionClient,
  turn: {
    sokoBotId: string;
    userId: string;
    workspaceId: string;
    source: string;
    destinationAudience: Prisma.JsonValue;
  },
  roomId: string,
): Promise<boolean> {
  const bot = await tx.sokoBot.findFirst({
    where: {
      id: turn.sokoBotId,
      userId: turn.userId,
      workspaceId: turn.workspaceId,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!bot) return false;
  const workspace = await tx.workspace.findFirst({
    where: {
      id: turn.workspaceId,
      OR: [
        { userId: turn.userId },
        { organization: { members: { some: { userId: turn.userId } } } },
      ],
    },
    select: { id: true },
  });
  if (!workspace) return false;
  const room = await tx.chatRoom.findFirst({
    where: {
      id: roomId,
      archivedAt: null,
      ...(turn.source === "CHAT" ? {} : { kind: "direct" }),
      sokoBotMembers: { some: { sokoBotId: turn.sokoBotId } },
      userMembers: { some: { userId: turn.userId } },
    },
    select: {
      id: true,
      userMembers: { select: { userId: true } },
      coworkerMembers: { select: { coworkerId: true } },
      sokoBotMembers: { select: { sokoBotId: true } },
    },
  });
  const audience = audienceSchema.safeParse(turn.destinationAudience);
  if (!room || !audience.success) return false;
  const current = {
    userIds: room.userMembers.map((member) => member.userId).sort(),
    coworkerIds: room.coworkerMembers.map((member) => member.coworkerId).sort(),
    botIds: room.sokoBotMembers.map((member) => member.sokoBotId).sort(),
  };
  return (
    JSON.stringify(current.userIds) === JSON.stringify(audience.data.userIds) &&
    JSON.stringify(current.coworkerIds) ===
      JSON.stringify(audience.data.coworkerIds) &&
    JSON.stringify(current.botIds) === JSON.stringify(audience.data.botIds)
  );
}

/** Retries only persistence/transport. Never invokes inference or capabilities. */
export async function deliverSokoBotDelivery(id: string): Promise<boolean> {
  const now = new Date();
  const leaseToken = randomUUID();
  const claimed = await prisma.sokoBotDelivery.updateMany({
    where: {
      id,
      status: { in: ["PENDING", "PERSISTED"] },
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    data: {
      leaseToken,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      attempts: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return false;
  try {
    const { emitChatHumanMentionNotifications, persistChatHumanMentions } =
      await import("@/helpers/chat-human-mentions");
    // A ref: assigned inside the transaction callback, which control flow
    // analysis cannot see.
    const withdrawn: {
      current: { placeholderId: string; mentionId: string } | null;
    } = { current: null };
    const persisted = await serializableTransaction(async (tx) => {
      withdrawn.current = null;
      // Lock and fence before writes. A reclaimed worker cannot commit a message.
      const owned = await tx.sokoBotDelivery.updateMany({
        where: { id, leaseToken, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (owned.count !== 1) return null;
      const delivery = await tx.sokoBotDelivery.findUniqueOrThrow({
        where: { id },
        include: { turn: true },
      });
      const turn = delivery.turn;
      if (
        !delivery.roomId ||
        !(await destinationStillAuthorized(tx, turn, delivery.roomId))
      ) {
        await tx.sokoBotDelivery.update({
          where: { id },
          data: {
            status: "SUPPRESSED",
            reason: "DESTINATION_REVOKED",
            leaseToken: null,
            leaseUntil: null,
          },
        });
        if (
          delivery.purpose === "FINAL" &&
          delivery.destinationId === turn.destinationRoomId
        )
          await releasePendingNudges(tx, turn.id);
        // A chat reply has a "Thinking…" placeholder already in the room.
        // Suppressing the answer without closing it left that bubble
        // spinning for good; withdraw it the way a silent reply does.
        if (
          turn.source === "CHAT" &&
          turn.chatResponseMessageId &&
          turn.chatMentionId
        ) {
          await tx.chatRoomMention.updateMany({
            where: {
              id: turn.chatMentionId,
              status: { in: ["pending", "sent"] },
            },
            data: {
              status: "failed",
              error: "The room changed before the reply was ready",
            },
          });
          const closed = await tx.chatRoomMessage.updateMany({
            where: {
              id: turn.chatResponseMessageId,
              senderSokoBotId: turn.sokoBotId,
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          });
          if (closed.count === 1)
            withdrawn.current = {
              placeholderId: turn.chatResponseMessageId,
              mentionId: turn.chatMentionId,
            };
        }
        return null;
      }
      if (delivery.status === "PERSISTED") return delivery;
      let messageId: string;
      if (turn.source === "CHAT") {
        if (!turn.chatResponseMessageId || !turn.chatMentionId)
          throw new Error("CHAT_DESTINATION_MISSING");
        const existing = await tx.chatRoomMessage.findFirst({
          where: {
            id: turn.chatResponseMessageId,
            roomId: delivery.roomId,
            senderSokoBotId: turn.sokoBotId,
          },
          select: { id: true },
        });
        if (!existing) throw new Error("CHAT_DESTINATION_MISSING");
        await persistSokoBotChatTurn(turn.id, tx);
        messageId = existing.id;
      } else {
        const message = await tx.chatRoomMessage.upsert({
          where: {
            roomId_clientMessageId: {
              roomId: delivery.roomId,
              clientMessageId: `soko-bot:${turn.id}:${delivery.purpose === "FINAL" ? "final" : delivery.id}`,
            },
          },
          create: {
            roomId: delivery.roomId,
            clientMessageId: `soko-bot:${turn.id}:${delivery.purpose === "FINAL" ? "final" : delivery.id}`,
            senderSokoBotId: turn.sokoBotId,
            content: turn.finalAnswer?.trim() ?? "",
            metadata: { soko_bot: { turn_id: turn.id, source: turn.source } },
          },
          update: {},
          select: { id: true },
        });
        messageId = message.id;
        await tx.chatRoom.update({
          where: { id: delivery.roomId },
          data: { updatedAt: new Date() },
        });
      }
      if (delivery.reason !== "SILENT") {
        const content = await tx.chatRoomMessage.findUniqueOrThrow({
          where: { id: messageId },
          select: { content: true },
        });
        await persistChatHumanMentions(tx, {
          messageId,
          roomId: delivery.roomId,
          content: content.content,
        });
      }
      return tx.sokoBotDelivery.update({
        where: { id },
        data: { status: "PERSISTED", messageId },
        include: { turn: true },
      });
    }, "Soko Bot delivery collided with another operation");
    const { publishChatRoomMessageRealtimeById } = await import(
      "@/helpers/chat-room-message-realtime"
    );
    if (withdrawn.current) {
      const { placeholderId, mentionId } = withdrawn.current;
      await publishChatRoomMessageRealtimeById(placeholderId, "delete");
      const mention = await prisma.chatRoomMention.findUnique({
        where: { id: mentionId },
        select: { messageId: true },
      });
      if (mention)
        await publishChatRoomMessageRealtimeById(
          mention.messageId,
          "mention_status",
        );
    }
    if (!persisted?.messageId || !persisted.roomId) return false;
    // Publication may happen twice after a crash. Both events carry the same ID.
    const publicationLease = await prisma.sokoBotDelivery.updateMany({
      where: {
        id,
        leaseToken,
        leaseUntil: { gt: new Date() },
        status: "PERSISTED",
      },
      data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
    if (publicationLease.count !== 1) return false;
    await publishChatRoomMessageRealtimeById(
      persisted.messageId,
      persisted.reason === "SILENT"
        ? "delete"
        : persisted.turn.source === "CHAT"
          ? "update"
          : "create",
      { throwOnError: true },
    );
    if (persisted.turn.chatMentionId) {
      const mention = await prisma.chatRoomMention.findUnique({
        where: { id: persisted.turn.chatMentionId },
        select: { messageId: true },
      });
      if (mention)
        await publishChatRoomMessageRealtimeById(
          mention.messageId,
          "mention_status",
          { throwOnError: true },
        );
    }
    await invalidateChatRoomMessageReaders({
      roomId: persisted.roomId,
      throwOnError: true,
    });
    if (persisted.reason !== "SILENT") {
      const mentions = await prisma.chatRoomUserMention.findMany({
        where: { messageId: persisted.messageId },
        select: { userId: true },
      });
      await emitChatHumanMentionNotifications({
        messageId: persisted.messageId,
        mentionedUserIds: mentions.map((mention) => mention.userId),
        throwOnError: true,
      });
    }
    const published = await serializableTransaction(async (tx) => {
      const changed = await tx.sokoBotDelivery.updateMany({
        where: {
          id,
          leaseToken,
          leaseUntil: { gt: new Date() },
          status: "PERSISTED",
        },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          leaseToken: null,
          leaseUntil: null,
          lastErrorCategory: null,
        },
      });
      if (
        changed.count === 1 &&
        persisted.purpose === "FINAL" &&
        persisted.destinationId === persisted.turn.destinationRoomId
      ) {
        if (persisted.reason === "SILENT")
          await releasePendingNudges(tx, persisted.turn.id);
        else
          await tx.sokoBotNudge.updateMany({
            where: { pendingTurnId: persisted.turn.id, state: "ACTIVE" },
            data: {
              pendingTurnId: null,
              lastDeliveryId: id,
              lastDeliveredAt: new Date(),
              nextCheckAt: null,
            },
          });
      }
      return changed;
    }, "Delivery publication collided with reminder staging");
    return published.count === 1;
  } catch (error) {
    const delivery = await prisma.sokoBotDelivery.findFirst({
      where: { id, leaseToken },
      include: { turn: { select: { destinationRoomId: true } } },
    });
    if (!delivery) return false;
    const invalidDestination =
      error instanceof Error && error.message === "CHAT_DESTINATION_MISSING";
    const expired = Date.now() - delivery.createdAt.getTime() >= MAX_AGE_MS;
    const delay =
      RETRY_DELAYS_MS[
        Math.min(delivery.attempts - 1, RETRY_DELAYS_MS.length - 1)
      ] ?? 60_000;
    await serializableTransaction(async (tx) => {
      const changed = await tx.sokoBotDelivery.updateMany({
        where: { id, leaseToken },
        data: {
          ...(invalidDestination
            ? { status: "BLOCKED", reason: "CHAT_DESTINATION_MISSING" }
            : expired
              ? { status: "DEAD_LETTER", reason: "RETRY_EXHAUSTED" }
              : {}),
          lastErrorCategory:
            delivery.status === "PERSISTED"
              ? "TRANSPORT_FAILED"
              : "PERSISTENCE_FAILED",
          nextAttemptAt: new Date(
            Date.now() + delay + Math.floor(Math.random() * delay * 0.1),
          ),
          leaseToken: null,
          leaseUntil: null,
        },
      });
      if (
        changed.count === 1 &&
        (invalidDestination || expired) &&
        delivery.purpose === "FINAL" &&
        delivery.destinationId === delivery.turn.destinationRoomId
      )
        await releasePendingNudges(tx, delivery.turnId);
    }, "Delivery failure collided with reminder staging");
    return false;
  }
}

/** Best-effort prompt dispatch; durable workers remain the source of retry truth. */
export async function deliverSokoBotTurnOutbox(turnId: string): Promise<void> {
  const [deliveries, effects] = await Promise.all([
    prisma.sokoBotDelivery.findMany({
      where: { turnId },
      select: { id: true },
    }),
    prisma.sokoBotEffectOutbox.findMany({
      where: { receipt: { turnId }, status: { in: ["PENDING", "PERSISTED"] } },
      select: { id: true },
    }),
  ]);
  await Promise.all([
    ...deliveries.map((delivery) => deliverSokoBotDelivery(delivery.id)),
    ...effects.map((effect) => deliverSokoBotEffect(effect.id)),
  ]);
}

export async function syncSokoBotDeliveries(input: {
  shouldContinue: () => boolean;
  abortSignal: AbortSignal;
}): Promise<number> {
  let published = 0;
  while (!input.abortSignal.aborted && input.shouldContinue()) {
    const due = await prisma.sokoBotDelivery.findMany({
      where: {
        status: { in: ["PENDING", "PERSISTED"] },
        nextAttemptAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: 20,
      select: { id: true },
    });
    for (const delivery of due) {
      if (input.abortSignal.aborted || !input.shouldContinue()) break;
      if (await deliverSokoBotDelivery(delivery.id)) published += 1;
    }
    if (due.length < 20) break;
  }
  return published;
}
