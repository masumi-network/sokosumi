import { createRoute, z } from "@hono/zod-openapi";
import { TaskVisibility } from "@sokosumi/database";
import {
  formatTaskIdentifier,
  type TaskChatRoomRefusal,
  taskChatMessage,
  taskChatRoomRefusal,
} from "@sokosumi/utils";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { conflict, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  buildSelfDirectRoomKey,
  chatRoomMessageInclude,
  mapChatRoomMessage,
  withChatRoomReplyCount,
} from "@/routes/v1/chats/rooms/helpers";
import { emitHumanRoomMessageEffects } from "@/routes/v1/chats/rooms/human-message-effects";
import { requireWritableChatRoom } from "@/routes/v1/chats/rooms/writable-chat-room";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";

import { lockTaskChatSend } from "./send-lock";

const NOTE_MAX_LENGTH = 2000;

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const requestSchema = z
  .object({
    roomId: z.string().uuid(),
    note: z.string().max(NOTE_MAX_LENGTH).optional(),
    clientMessageId: z.string().trim().min(1).max(200),
  })
  .openapi("SendTaskToChatRequest");

const route = createRoute({
  method: "post",
  path: "/{id}/chat-messages",
  description:
    "Post a link to a Task, with an optional note, into a chat room the caller belongs to. The Task and the room are read at write time: the Task must be readable and not private, and the room must be the caller's notes or a room of the Task's organization with no guests, Coworkers or Soko Bots. The message mentions no one and starts no agent. The Task, the sender's memberships and the room stay locked until the message commits. A retry with the same clientMessageId, Task and note returns the first message, even after the Task was renamed or the message edited; anything else under that id is a 409.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: { content: { "application/json": { schema: requestSchema } } },
  },
  responses: {
    201: jsonSuccessResponse(chatRoomMessageSchema, "Task sent to chat"),
    400: jsonErrorResponse("Invalid request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Task or room not found"),
    409: jsonErrorResponse("clientMessageId already used for another message"),
  },
});

const REFUSAL_MESSAGES: Record<TaskChatRoomRefusal, string> = {
  "agent-members":
    "Tasks cannot be sent to rooms with a Coworker or Soko Bot in them.",
  guests: "Tasks cannot be sent to rooms open to guests.",
  "other-workspace":
    "Tasks can be sent only to rooms of the Task's organization or to your notes.",
};

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { roomId, note: rawNote = "", clientMessageId } = c.req.valid("json");
    // What the attempt is, as sent; rendered content changes with the Task.
    const attempt = { taskId: id, note: rawNote.trim() };

    const sent = await prisma
      .$transaction(async (tx) => {
        // Both reads happen at write time, so a Task made private or moved,
        // or a room opened to guests, after the dialog loaded is refused.
        // The locks keep what they read in force until the message commits.
        await lockTaskChatSend(tx, { taskId: id, roomId, userId });
        const task = await requireTaskReadForRouteVars(c.var, id, tx, {
          project: { select: { identifier: true } },
          workspace: { select: { organizationId: true } },
        });
        if (task.visibility === TaskVisibility.PRIVATE) {
          throw forbidden("Private tasks cannot be sent to chat.");
        }
        const room = await requireWritableChatRoom(roomId, userId, tx);
        const refusal = taskChatRoomRefusal(
          {
            kind: room.kind === "direct" ? "direct" : "channel",
            organizationId: room.organizationId,
            discoverability: room.discoverability,
            isSelfDirect:
              room.kind === "direct" &&
              room.organizationId === null &&
              room.userMembers.length === 1 &&
              room.directKey === buildSelfDirectRoomKey(userId),
            hasAgentMembers:
              room.coworkerMembers.length > 0 ||
              room.sokoBotMembers.length > 0 ||
              room.sharedSokoBot !== null,
            hasGuests: room.userMembers.some(
              (member) => member.access === "guest",
            ),
          },
          task.workspace.organizationId,
        );
        if (refusal) {
          throw forbidden(REFUSAL_MESSAGES[refusal]);
        }

        const content = taskChatMessage(
          {
            id: task.id,
            identifier: formatTaskIdentifier(
              task.project?.identifier,
              task.number,
            ),
            name: task.name,
          },
          attempt.note,
        );
        const roomSummary = {
          id: room.id,
          name: room.groupName ?? room.name,
          organizationId: room.organizationId,
          kind: room.kind,
          memberUserIds: room.userMembers.map((member) => member.userId),
        };

        const existing = await tx.chatRoomMessage.findUnique({
          where: {
            roomId_clientMessageId: { roomId: room.id, clientMessageId },
          },
          include: chatRoomMessageInclude,
        });
        if (existing) {
          return {
            message: assertSameAttempt(existing, userId, attempt),
            room: roomSummary,
            didCreate: false,
          };
        }

        // No mention rows, so nothing is dispatched to a Coworker or Soko Bot.
        const message = await tx.chatRoomMessage.create({
          data: {
            roomId: room.id,
            senderUserId: userId,
            content,
            clientMessageId,
            metadata: {
              client_message_id: clientMessageId,
              [TASK_CHAT_ATTEMPT_KEY]: attempt,
            },
          },
          include: chatRoomMessageInclude,
        });
        await tx.chatRoom.update({
          where: { id: room.id },
          data: { updatedAt: new Date() },
        });
        await tx.chatRoomReadState.upsert({
          where: { roomId_userId: { roomId: room.id, userId } },
          update: { lastReadAt: message.createdAt },
          create: { roomId: room.id, userId, lastReadAt: message.createdAt },
        });
        return { message, room: roomSummary, didCreate: true };
      })
      .catch(async (error: unknown) => {
        // Two sends of one attempt raced; the loser returns the winner's row.
        if (!isPrismaUniqueViolation(error)) throw error;
        const raced = await prisma.chatRoomMessage.findUnique({
          where: { roomId_clientMessageId: { roomId, clientMessageId } },
          include: chatRoomMessageInclude,
        });
        if (!raced) throw error;
        return {
          message: assertSameAttempt(raced, userId, attempt),
          room: null,
          didCreate: false,
        };
      });

    const { message, room, didCreate } = sent;
    if (didCreate && room) {
      emitHumanRoomMessageEffects({
        message,
        room,
        authorUserId: userId,
        mentionedUserIds: [],
      });
    }
    await publishChatRoomMessageRealtime(message, "create");

    return created(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(
          await withChatRoomReplyCount(prisma, message),
          userId,
        ),
      ),
    );
  });
}

/** Where a sent Task's attempt is kept on its message. */
const TASK_CHAT_ATTEMPT_KEY = "task_chat_attempt";

/**
 * A retry is the same attempt when the same person sent the same Task with
 * the same note into the room (the room is part of the id's key). It is
 * compared on what was sent, not on the rendered message, so a Task renamed
 * or a message edited since still answers with the first message. Anything
 * else under the id is a different message and is refused.
 */
export function assertSameAttempt<
  T extends { senderUserId: string | null; metadata: unknown },
>(message: T, userId: string, attempt: { taskId: string; note: string }): T {
  const stored =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)[TASK_CHAT_ATTEMPT_KEY]
      : undefined;
  const same =
    message.senderUserId === userId &&
    stored !== null &&
    typeof stored === "object" &&
    (stored as { taskId?: unknown }).taskId === attempt.taskId &&
    (stored as { note?: unknown }).note === attempt.note;
  if (!same) {
    throw conflict("clientMessageId already used for another message");
  }
  return message;
}
