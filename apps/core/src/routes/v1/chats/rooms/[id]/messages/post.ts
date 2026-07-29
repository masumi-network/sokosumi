import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { waitUntil } from "@vercel/functions";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
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

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserWriteAccess,
  resolveMentionedCoworkerIds,
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
      "Post a room message. Mentioned AI coworkers — and, for thread replies, every coworker already part of the thread — are called asynchronously and reply into the room. Coworker API keys may post as the coworker itself into rooms it is a member of.",
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
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

async function resolveThreadParentMessageId(
  tx: Prisma.TransactionClient,
  roomId: string,
  requestedParentMessageId: string | undefined,
): Promise<string | null> {
  if (!requestedParentMessageId) {
    return null;
  }
  const parentMessage = await tx.chatRoomMessage.findFirst({
    where: {
      id: requestedParentMessageId,
      roomId,
    },
    select: {
      id: true,
      parentMessageId: true,
    },
  });
  if (!parentMessage) {
    throw badRequest("Thread message not found");
  }
  return parentMessage.parentMessageId ?? parentMessage.id;
}

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
      const message = await prisma.$transaction(async (tx) => {
        const room = await tx.chatRoom.findFirst({
          where: {
            id,
            archivedAt: null,
            coworkerMembers: {
              some: { coworkerId },
            },
          },
          select: { id: true },
        });
        if (!room) {
          throw notFound("Room not found");
        }

        const parentMessageId = await resolveThreadParentMessageId(
          tx,
          room.id,
          body.parentMessageId,
        );

        const message = await tx.chatRoomMessage.create({
          data: {
            roomId: room.id,
            parentMessageId,
            senderCoworkerId: coworkerId,
            content: body.content,
          },
          include: chatRoomMessageInclude,
        });

        await tx.chatRoom.update({
          where: { id: room.id },
          data: { updatedAt: new Date() },
        });

        return message;
      });

      return created(
        c,
        chatRoomMessageSchema.parse(mapChatRoomMessage(message)),
      );
    }

    const userContext = requireUserAuthContext(authContext);

    const { message, mentionIds } = await prisma.$transaction(async (tx) => {
      const room = await requireChatRoomUserWriteAccess(
        id,
        userContext.userId,
        tx,
      );
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

      const message = await tx.chatRoomMessage.create({
        data: {
          roomId: room.id,
          parentMessageId,
          senderUserId: userContext.userId,
          content: body.content,
          mentionsAsSource: {
            create: mentionedCoworkerIds.map((coworkerId) => ({
              coworkerId,
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

      return {
        message,
        mentionIds: message.mentionsAsSource.map((mention) => mention.id),
      };
    });

    for (const mentionId of mentionIds) {
      waitUntil(dispatchChatRoomMention(mentionId));
    }

    return created(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(message, userContext.userId),
      ),
    );
  });
}
