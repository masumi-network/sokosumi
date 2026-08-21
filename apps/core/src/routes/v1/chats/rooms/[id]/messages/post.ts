import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import {
  emitChatDirectMessageNotifications,
  shouldEmitChatDirectMessageNotifications,
} from "@/helpers/chat-direct-message-notifications";
import { emitChatMentionNotifications } from "@/helpers/chat-mention-notifications";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  isCoworkerAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  chatRoomMessageSchema,
  createChatRoomMessageRequestSchema,
} from "@/schemas/chat-room.schema";
import { dispatchChatRoomMention } from "@/services/chat-room-coworker-dispatch.service";
import { scheduleChatRoomMessageUnfurls } from "@/services/chat-room-message-unfurl.service";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  markChatRoomThreadRead,
  mergeChatRoomMessageMetadata,
  requireChatRoomCoworkerAccess,
  requireChatRoomUserWriteAccess,
  resolveMentionedCoworkerIds,
  resolveMentionedUserIds,
  resolveRoomQuoteSnapshot,
  resolveThreadParentMessageId,
} from "../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/messages",
    description:
      "Post a room message. Mentioned AI coworkers — and, for thread replies, every coworker already part of the thread — are called asynchronously and reply into the room. Coworker API keys may post as the coworker itself into rooms it is a member of. Coworker posts into a Direct with at most two human members emit the same CHAT Direct notification as a human sender (mute honored; the coworker has no user id to skip).",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: createChatRoomMessageRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(chatRoomMessageSchema, "Room message created"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      409: jsonErrorResponse("Conflict"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = c.var.authContext;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // A coworker posts as itself into rooms it belongs to. Its messages
    // never create mention rows — nothing to poll, and no coworker→coworker
    // dispatch loops.
    if (isCoworkerAuthContext(authContext)) {
      const coworkerId = authContext.coworkerId;
      const persisted = await prisma.$transaction(async (tx) => {
        const room = await requireChatRoomCoworkerAccess(id, coworkerId, tx);

        const parentMessageId = await resolveThreadParentMessageId(
          tx,
          room.id,
          body.parentMessageId,
        );
        const quote = await resolveRoomQuoteSnapshot(
          tx,
          room.id,
          body.quote?.messageId,
        );
        const metadata = mergeChatRoomMessageMetadata(null, quote);

        const message = await tx.chatRoomMessage.create({
          data: {
            roomId: room.id,
            parentMessageId,
            senderCoworkerId: coworkerId,
            content: body.content,
            ...(metadata ? { metadata } : {}),
          },
          include: chatRoomMessageInclude,
        });

        await tx.chatRoom.update({
          where: { id: room.id },
          data: { updatedAt: new Date() },
        });

        return { message, room };
      });

      const { message, room } = persisted;

      await publishChatRoomMessageRealtime(message, "create");

      waitUntil(scheduleChatRoomMessageUnfurls(message.id));

      if (room.kind === "direct") {
        const memberUserIds = (
          await prisma.chatRoomUserMember.findMany({
            where: { roomId: room.id },
            select: { userId: true },
          })
        ).map((member) => member.userId);

        if (
          shouldEmitChatDirectMessageNotifications({
            kind: room.kind,
            memberUserIds,
          })
        ) {
          waitUntil(
            emitChatDirectMessageNotifications({
              roomId: room.id,
              roomName: room.name,
              organizationId: room.organizationId,
              messageId: message.id,
              authorUserId: null,
              authorName: message.senderCoworker?.name ?? "Someone",
              recipientUserIds: memberUserIds,
            }),
          );
        }
      }

      return created(
        c,
        chatRoomMessageSchema.parse(mapChatRoomMessage(message)),
      );
    }

    const userContext = requireUserAuthContext(authContext);
    const trimmedClientId =
      typeof body.clientMessageId === "string"
        ? body.clientMessageId.trim()
        : "";
    const clientId = trimmedClientId.length > 0 ? trimmedClientId : null;

    let persisted;
    try {
      persisted = await prisma.$transaction(async (tx) => {
        const room = await requireChatRoomUserWriteAccess(
          id,
          userContext.userId,
          tx,
        );

        if (clientId) {
          const existing = await tx.chatRoomMessage.findUnique({
            where: {
              roomId_clientMessageId: {
                roomId: room.id,
                clientMessageId: clientId,
              },
            },
            include: chatRoomMessageInclude,
          });
          if (existing) {
            if (existing.senderUserId !== userContext.userId) {
              throw conflict(
                "clientMessageId already used by another sender in this room",
              );
            }
            return {
              message: existing,
              mentionIds: [] as string[],
              mentionedUserIds: [] as string[],
              room: {
                id: room.id,
                name: room.name,
                organizationId: room.organizationId,
                kind: room.kind,
                memberUserIds: room.userMembers.map((member) => member.userId),
              },
              didCreate: false,
            };
          }
        }

        const skipCoworkerMentions =
          room.kind === "direct" &&
          room.coworkerMembers.length === 1 &&
          room.userMembers.length === 1 &&
          room.userMembers[0]?.userId === userContext.userId;

        const directCoworkerIds =
          room.kind === "direct" && !skipCoworkerMentions
            ? room.coworkerMembers.map(({ coworker }) => coworker.id)
            : [];

        const parentMessageId = await resolveThreadParentMessageId(
          tx,
          room.id,
          body.parentMessageId,
        );
        const quote = await resolveRoomQuoteSnapshot(
          tx,
          room.id,
          body.quote?.messageId,
        );
        const metadata = mergeChatRoomMessageMetadata(
          clientId ? { client_message_id: clientId } : null,
          quote,
        );

        // A thread reply goes to every coworker already part of the thread —
        // as a sender or a mention target — without requiring a fresh @mention.
        let threadCoworkerIds: string[] = [];
        if (parentMessageId) {
          const threadMessages = await tx.chatRoomMessage.findMany({
            where: {
              roomId: room.id,
              OR: [{ id: parentMessageId }, { parentMessageId }],
            },
            select: {
              senderCoworkerId: true,
              mentionsAsSource: { select: { coworkerId: true } },
            },
          });
          threadCoworkerIds = threadMessages.flatMap((threadMessage) => [
            ...(threadMessage.senderCoworkerId
              ? [threadMessage.senderCoworkerId]
              : []),
            ...threadMessage.mentionsAsSource.map(
              (mention) => mention.coworkerId,
            ),
          ]);
        }

        const mentionedCoworkerIds = skipCoworkerMentions
          ? []
          : resolveMentionedCoworkerIds({
              content: body.content,
              explicitCoworkerIds: [
                ...(body.mentionedCoworkerIds ?? []),
                ...directCoworkerIds,
                ...threadCoworkerIds,
              ],
              roomCoworkers: room.coworkerMembers.map(({ coworker }) => ({
                id: coworker.id,
                name: coworker.name,
                slug: coworker.slug,
              })),
            });

        const mentionedUserIds = resolveMentionedUserIds({
          content: body.content,
          explicitUserIds: body.mentionedUserIds ?? [],
          roomUsers: room.userMembers.map(({ userId, user }) => ({
            id: userId,
            name: user.name,
          })),
          excludeUserId: userContext.userId,
        });

        const message = await tx.chatRoomMessage.create({
          data: {
            roomId: room.id,
            parentMessageId,
            senderUserId: userContext.userId,
            content: body.content,
            ...(clientId ? { clientMessageId: clientId } : {}),
            ...(metadata ? { metadata } : {}),
            mentionsAsSource: {
              create: mentionedCoworkerIds.map((coworkerId) => ({
                coworkerId,
              })),
            },
            userMentionsAsSource: {
              create: mentionedUserIds.map((mentionedUserId) => ({
                userId: mentionedUserId,
              })),
            },
          },
          include: chatRoomMessageInclude,
        });

        await tx.chatRoom.update({
          where: { id: room.id },
          data: { updatedAt: new Date() },
        });
        await tx.chatRoomReadState.upsert({
          where: {
            roomId_userId: {
              roomId: room.id,
              userId: userContext.userId,
            },
          },
          update: { lastReadAt: message.createdAt },
          create: {
            roomId: room.id,
            userId: userContext.userId,
            lastReadAt: message.createdAt,
          },
        });
        if (parentMessageId) {
          await markChatRoomThreadRead(
            room.id,
            userContext.userId,
            parentMessageId,
            tx,
            message.createdAt,
          );
        }

        return {
          message,
          mentionIds: message.mentionsAsSource.map((mention) => mention.id),
          mentionedUserIds,
          room: {
            id: room.id,
            name: room.name,
            organizationId: room.organizationId,
            kind: room.kind,
            memberUserIds: room.userMembers.map((member) => member.userId),
          },
          didCreate: true,
        };
      });
    } catch (error) {
      if (!clientId || !isPrismaUniqueViolation(error)) {
        throw error;
      }
      // Interactive tx aborted after failed create — re-read on root client.
      const raced = await prisma.chatRoomMessage.findUnique({
        where: {
          roomId_clientMessageId: {
            roomId: id,
            clientMessageId: clientId,
          },
        },
        include: chatRoomMessageInclude,
      });
      if (!raced) {
        throw error;
      }
      if (raced.senderUserId !== userContext.userId) {
        throw conflict(
          "clientMessageId already used by another sender in this room",
        );
      }
      await publishChatRoomMessageRealtime(raced, "create");

      return created(
        c,
        chatRoomMessageSchema.parse(
          mapChatRoomMessage(raced, userContext.userId),
        ),
      );
    }

    const { message, mentionIds, mentionedUserIds, room, didCreate } =
      persisted;

    if (didCreate) {
      for (const mentionId of mentionIds) {
        waitUntil(dispatchChatRoomMention(mentionId));
      }

      if (mentionedUserIds.length > 0) {
        waitUntil(
          emitChatMentionNotifications({
            roomId: room.id,
            roomName: room.name,
            organizationId: room.organizationId,
            messageId: message.id,
            authorUserId: userContext.userId,
            authorName: message.senderUser?.name ?? "Someone",
            mentionedUserIds,
          }),
        );
      }

      if (
        shouldEmitChatDirectMessageNotifications({
          kind: room.kind,
          memberUserIds: room.memberUserIds,
        })
      ) {
        const mentionedUserIdSet = new Set(mentionedUserIds);
        const recipientUserIds = room.memberUserIds.filter(
          (userId) =>
            userId !== userContext.userId && !mentionedUserIdSet.has(userId),
        );
        if (recipientUserIds.length > 0) {
          waitUntil(
            emitChatDirectMessageNotifications({
              roomId: room.id,
              roomName: room.name,
              organizationId: room.organizationId,
              messageId: message.id,
              authorUserId: userContext.userId,
              authorName: message.senderUser?.name ?? "Someone",
              recipientUserIds,
            }),
          );
        }
      }

      waitUntil(scheduleChatRoomMessageUnfurls(message.id));
    }

    await publishChatRoomMessageRealtime(message, "create");

    return created(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(message, userContext.userId),
      ),
    );
  });
}
