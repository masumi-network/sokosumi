import { createRoute, z } from "@hono/zod-openapi";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { publishChatRoomsChanged } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";

import {
  buildRoomQuoteSnapshot,
  chatRoomMessageInclude,
  createOrGetDirectRoom,
  isSelfDirectRoom,
  mapChatRoomMessage,
  mergeChatRoomMessageMetadata,
  requireChatRoomUserAccess,
  roomQuoteSourceSelect,
} from "../../../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  messageId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "messageId", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/messages/{messageId}/send-to-self",
    description:
      "Send to yourself: post a quote of a readable room message into the caller's Self Direct, creating it on demand. The new message has an empty body and a quote that carries the source `roomId`. The quote snapshot stays readable after the caller loses access to the source room. Rejected for messages inside the Self Direct itself.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      201: jsonSuccessResponse(
        chatRoomMessageSchema,
        "Quote created in the caller's Self Direct",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Message not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, messageId } = c.req.valid("param");

    // Read-only: the snapshot is durable, so these two reads need no transaction.
    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );
    if (isSelfDirectRoom(room)) {
      throw badRequest("Messages in your Self Direct are already there.");
    }

    const source = await prisma.chatRoomMessage.findFirst({
      where: { id: messageId, roomId: id, deletedAt: null },
      select: roomQuoteSourceSelect,
    });
    if (!source) {
      throw notFound("Message not found");
    }

    const quote = { ...buildRoomQuoteSnapshot(source), roomId: id };

    const selfDirect = await createOrGetDirectRoom({
      organizationId: null,
      currentUserId: userContext.userId,
      memberUserIds: [userContext.userId],
      coworkerIds: [],
    });
    const selfDirectId = selfDirect.room.id;

    const message = await prisma.$transaction(async (tx) => {
      const createdMessage = await tx.chatRoomMessage.create({
        data: {
          roomId: selfDirectId,
          senderUserId: userContext.userId,
          content: "",
          metadata: mergeChatRoomMessageMetadata(null, quote) ?? undefined,
        },
        include: chatRoomMessageInclude,
      });
      await tx.chatRoom.update({
        where: { id: selfDirectId },
        data: { updatedAt: new Date() },
      });
      await tx.chatRoomReadState.upsert({
        where: {
          roomId_userId: { roomId: selfDirectId, userId: userContext.userId },
        },
        update: { lastReadAt: createdMessage.createdAt },
        create: {
          roomId: selfDirectId,
          userId: userContext.userId,
          lastReadAt: createdMessage.createdAt,
        },
      });
      return createdMessage;
    });

    await publishChatRoomMessageRealtime(message, "create");
    if (selfDirect.created) {
      await publishChatRoomsChanged({
        userIds: [userContext.userId],
        collections: ["active"],
        roomId: selfDirectId,
      });
    }

    return created(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(message, userContext.userId),
      ),
    );
  });
}
