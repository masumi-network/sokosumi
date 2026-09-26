import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";

const chatPayload = z.object({
  messageId: z.string(),
  roomId: z.string(),
  content: z.string(),
  userIds: z.array(z.string()),
  coworkerIds: z.array(z.string()),
  botIds: z.array(z.string()),
});
const taskPayload = z.object({ taskId: z.string(), eventId: z.string() });

export async function enqueueSokoBotEffect(
  tx: Prisma.TransactionClient,
  input: {
    receiptId: string;
    purpose: "TASK_EVENT" | "CHAT_MESSAGE";
    payload: Prisma.InputJsonValue;
  },
) {
  return tx.sokoBotEffectOutbox.upsert({
    where: {
      receiptId_purpose: { receiptId: input.receiptId, purpose: input.purpose },
    },
    create: input,
    update: {},
  });
}

/** Publishes committed effects only. No tool invocation or inference retry. */
export async function deliverSokoBotEffect(id: string): Promise<boolean> {
  const leaseToken = randomUUID();
  const now = new Date();
  const owned = await prisma.sokoBotEffectOutbox.updateMany({
    where: {
      id,
      status: { in: ["PENDING", "PERSISTED"] },
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    data: {
      leaseToken,
      leaseUntil: new Date(Date.now() + 120_000),
      attempts: { increment: 1 },
    },
  });
  if (owned.count !== 1) return false;
  const effect = await prisma.sokoBotEffectOutbox.findUniqueOrThrow({
    where: { id },
    include: { receipt: { include: { turn: true } } },
  });
  async function renewLease() {
    const renewed = await prisma.sokoBotEffectOutbox.updateMany({
      where: {
        id,
        leaseToken,
        status: { in: ["PENDING", "PERSISTED"] },
        leaseUntil: { gt: new Date() },
      },
      data: { leaseUntil: new Date(Date.now() + 120_000) },
    });
    return renewed.count === 1;
  }
  async function suppress(reason: string) {
    await serializableTransaction(async (tx) => {
      const changed = await tx.sokoBotEffectOutbox.updateMany({
        where: { id, leaseToken, leaseUntil: { gt: new Date() } },
        data: {
          status: reason === "RETRY_EXHAUSTED" ? "DEAD_LETTER" : "SUPPRESSED",
          reason,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      if (changed.count !== 1 || effect.purpose !== "CHAT_MESSAGE") return;
      const payload = chatPayload.safeParse(effect.payload);
      if (!payload.success) return;
      await tx.chatRoomMessage.updateMany({
        where: {
          id: payload.data.messageId,
          senderSokoBotId: effect.receipt.turn.sokoBotId,
        },
        data: { content: "", deletedAt: new Date() },
      });
      await tx.chatRoomMention.updateMany({
        where: {
          messageId: payload.data.messageId,
          status: { in: ["staged", "pending"] },
        },
        data: {
          status: "failed",
          error: `Soko Bot delivery suppressed: ${reason}`,
        },
      });
    }, "Effect suppression collided with delivery");
    return false;
  }
  try {
    const turn = effect.receipt.turn;
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: turn.workspaceId,
        OR: [
          { userId: turn.userId },
          { organization: { members: { some: { userId: turn.userId } } } },
        ],
      },
      select: { id: true },
    });
    const bot = await prisma.sokoBot.findFirst({
      where: {
        id: turn.sokoBotId,
        userId: turn.userId,
        workspaceId: turn.workspaceId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!workspace || !bot || effect.receipt.status !== "COMPLETED")
      return suppress("AUTHORITY_REVOKED");
    if (effect.purpose === "TASK_EVENT") {
      const payload = taskPayload.parse(effect.payload);
      const event = await prisma.taskEvent.findFirst({
        where: {
          id: payload.eventId,
          taskId: payload.taskId,
          task: { workspaceId: turn.workspaceId },
        },
        include: {
          task: {
            select: {
              id: true,
              ownerId: true,
              assigneeUserId: true,
              archivedAt: true,
            },
          },
        },
      });
      if (!event) return suppress("EVENT_UNAVAILABLE");
      const { publishTaskEventData } = await import("@/lib/ably/publish");
      const { notifyTaskStatusEvent } = await import(
        "@/helpers/task-notifications"
      );
      if (!(await renewLease())) return false;
      const { deliverCalendarInvalidationsNow } = await import(
        "@/helpers/calendar-invalidation"
      );
      await deliverCalendarInvalidationsNow(turn.workspaceId);
      if (
        effect.receipt.capability === "archive_task" &&
        event.task.archivedAt
      ) {
        const { markTaskArchivedRead } = await import(
          "@/helpers/task-notifications"
        );
        await markTaskArchivedRead(event.task);
      }
      if (!(await renewLease())) return false;
      await publishTaskEventData({
        userId: event.task.ownerId,
        taskId: event.taskId,
        eventType: "task_event",
      });
      if (!(await renewLease())) return false;
      if (event.status)
        await notifyTaskStatusEvent(
          event.taskId,
          event.id,
          event.status,
          event.userId ?? null,
          {
            throwOnError: true,
          },
        );
    } else if (effect.purpose === "CHAT_MESSAGE") {
      const { emitChatHumanMentionNotifications, persistChatHumanMentions } =
        await import("@/helpers/chat-human-mentions");
      const payload = chatPayload.parse(effect.payload);
      const prepared = await serializableTransaction(async (tx) => {
        const fence = await tx.sokoBotEffectOutbox.updateMany({
          where: {
            id,
            leaseToken,
            status: { in: ["PENDING", "PERSISTED"] },
            leaseUntil: { gt: new Date() },
          },
          data: { leaseUntil: new Date(Date.now() + 120_000) },
        });
        if (fence.count !== 1) return { message: null, reason: null };
        const authority = await tx.sokoBot.findFirst({
          where: {
            id: turn.sokoBotId,
            userId: turn.userId,
            workspaceId: turn.workspaceId,
            archivedAt: null,
          },
          select: { id: true },
        });
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
        if (!authority || !workspace)
          return { message: null, reason: "AUTHORITY_REVOKED" };
        const current = await tx.sokoBotEffectOutbox.findUniqueOrThrow({
          where: { id },
          select: { status: true },
        });
        const message = await tx.chatRoomMessage.findFirst({
          where: {
            id: payload.messageId,
            roomId: payload.roomId,
            senderSokoBotId: turn.sokoBotId,
          },
          include: {
            senderSokoBot: { select: { name: true, archivedAt: true } },
            room: {
              include: {
                userMembers: { select: { userId: true } },
                coworkerMembers: { select: { coworkerId: true } },
                sokoBotMembers: { select: { sokoBotId: true } },
              },
            },
          },
        });
        if (
          !message ||
          message.room.archivedAt ||
          !message.senderSokoBot ||
          message.senderSokoBot.archivedAt ||
          (current.status === "PERSISTED" && message.deletedAt)
        )
          return { message: null, reason: "MESSAGE_UNAVAILABLE" };
        const room = message.room;
        const rosterMatches =
          JSON.stringify(room.userMembers.map((m) => m.userId).sort()) ===
            JSON.stringify(payload.userIds) &&
          JSON.stringify(
            room.coworkerMembers.map((m) => m.coworkerId).sort(),
          ) === JSON.stringify(payload.coworkerIds) &&
          JSON.stringify(room.sokoBotMembers.map((m) => m.sokoBotId).sort()) ===
            JSON.stringify(payload.botIds);
        if (!rosterMatches || !payload.botIds.includes(turn.sokoBotId))
          return { message: null, reason: "AUDIENCE_CHANGED" };
        if (current.status === "PENDING") {
          await tx.chatRoomMessage.update({
            where: { id: message.id },
            data: { content: payload.content, deletedAt: null },
          });
          await persistChatHumanMentions(tx, {
            messageId: message.id,
            roomId: room.id,
            content: payload.content,
          });
          await tx.chatRoomMention.updateMany({
            where: { messageId: message.id, status: "staged" },
            data: { status: "pending" },
          });
          await tx.chatRoom.update({
            where: { id: room.id },
            data: { updatedAt: new Date() },
          });
          await tx.sokoBotEffectOutbox.updateMany({
            where: { id, leaseToken },
            data: { status: "PERSISTED" },
          });
        }
        return {
          message: { ...message, content: payload.content },
          reason: null,
        };
      }, "Chat effect activation collided with room membership");
      if (prepared.reason) return suppress(prepared.reason);
      const message = prepared.message;
      if (!message || !message.senderSokoBot) return false;
      const room = message.room;
      const { publishChatRoomMessageRealtimeById } = await import(
        "@/helpers/chat-room-message-realtime"
      );
      const { invalidateChatRoomMessageReaders } = await import(
        "@/helpers/chat-room-message-created-effects"
      );
      const {
        emitChatDirectMessageNotifications,
        shouldEmitChatDirectMessageNotifications,
      } = await import("@/helpers/chat-direct-message-notifications");
      if (!(await renewLease())) return false;
      await publishChatRoomMessageRealtimeById(message.id, "create", {
        throwOnError: true,
      });
      await invalidateChatRoomMessageReaders({
        roomId: room.id,
        memberUserIds: payload.userIds,
        throwOnError: true,
      });
      if (!(await renewLease())) return false;
      const humanMentions = await prisma.chatRoomUserMention.findMany({
        where: { messageId: message.id },
        select: { userId: true },
      });
      const mentionedUserIds = humanMentions.map((mention) => mention.userId);
      if (
        shouldEmitChatDirectMessageNotifications({
          kind: room.kind,
          memberUserIds: payload.userIds,
        })
      ) {
        await emitChatDirectMessageNotifications({
          roomId: room.id,
          roomName: room.name,
          organizationId: room.organizationId,
          messageId: message.id,
          content: message.content,
          authorUserId: null,
          authorName: message.senderSokoBot.name ?? "Assistant",
          recipientUserIds: payload.userIds.filter(
            (userId) => !mentionedUserIds.includes(userId),
          ),
          throwOnError: true,
        });
      }
      if (!(await renewLease())) return false;
      await emitChatHumanMentionNotifications({
        messageId: message.id,
        mentionedUserIds,
        throwOnError: true,
      });
      const mentions = await prisma.chatRoomMention.findMany({
        where: { messageId: message.id, status: "pending" },
        select: { id: true },
      });
      if (mentions.length) {
        const { dispatchChatRoomMention } = await import(
          "@/services/chat-room-coworker-dispatch.service"
        );
        for (const mention of mentions) {
          if (!(await renewLease())) return false;
          await dispatchChatRoomMention(mention.id);
        }
      }
    } else {
      return suppress("INVALID_PURPOSE");
    }
    const completed = await prisma.sokoBotEffectOutbox.updateMany({
      where: { id, leaseToken, leaseUntil: { gt: new Date() } },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
        lastErrorCategory: null,
      },
    });
    return completed.count === 1;
  } catch (_error) {
    const exhausted = Date.now() - effect.createdAt.getTime() >= 86_400_000;
    if (exhausted && effect.purpose === "CHAT_MESSAGE") {
      await suppress("RETRY_EXHAUSTED");
      return false;
    }
    const delay = Math.min(
      60_000 * 5 ** Math.min(effect.attempts - 1, 4),
      7_200_000,
    );
    await prisma.sokoBotEffectOutbox.updateMany({
      where: { id, leaseToken },
      data: {
        ...(exhausted
          ? { status: "DEAD_LETTER", reason: "RETRY_EXHAUSTED" }
          : {}),
        lastErrorCategory: "EFFECT_PUBLICATION_FAILED",
        nextAttemptAt: new Date(
          Date.now() + delay + Math.floor(Math.random() * delay * 0.1),
        ),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return false;
  }
}

export async function syncSokoBotEffects(input: {
  shouldContinue: () => boolean;
  abortSignal: AbortSignal;
}): Promise<number> {
  let published = 0;
  while (!input.abortSignal.aborted && input.shouldContinue()) {
    const effects = await prisma.sokoBotEffectOutbox.findMany({
      where: {
        status: { in: ["PENDING", "PERSISTED"] },
        nextAttemptAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: 20,
      select: { id: true },
    });
    for (const effect of effects) {
      if (input.abortSignal.aborted || !input.shouldContinue()) break;
      if (await deliverSokoBotEffect(effect.id)) published++;
    }
    if (effects.length < 20) break;
  }
  return published;
}
