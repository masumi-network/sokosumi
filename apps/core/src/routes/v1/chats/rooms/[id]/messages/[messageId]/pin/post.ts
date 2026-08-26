import { createRoute, z } from "@hono/zod-openapi";

import { publishChatRoomPinnedMessageRealtime } from "@/helpers/chat-room-pinned-message-realtime";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomPinnedMessageMutationSchema } from "@/schemas/chat-room.schema";

import { requireChatRoomUserMembership } from "../../../../helpers";
import { assertChatRoomContentMessage } from "../../../../membership-status";

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

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/messages/{messageId}/pin",
    description:
      "Pin a top-level Channel message onto that Channel's shared pin list. Idempotent if already pinned. Directs and thread replies are rejected.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomPinnedMessageMutationSchema,
        "Message pinned",
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

    const result = await prisma.$transaction(async (tx) => {
      const room = await requireChatRoomUserMembership(
        id,
        userContext.userId,
        tx,
      );
      if (room.kind !== "channel") {
        throw badRequest("Only Channels can have pinned messages.");
      }

      const message = await tx.chatRoomMessage.findFirst({
        where: { id: messageId, roomId: id },
        select: {
          id: true,
          parentMessageId: true,
          deletedAt: true,
          metadata: true,
        },
      });
      if (!message || message.deletedAt != null) {
        throw notFound("Message not found");
      }
      if (message.parentMessageId != null) {
        throw badRequest("Only top-level Channel messages can be pinned.");
      }
      assertChatRoomContentMessage(message.metadata);

      const created = await tx.chatRoomPinnedMessage.createMany({
        data: {
          roomId: id,
          messageId,
          pinnedByUserId: userContext.userId,
        },
        skipDuplicates: true,
      });

      const pinnedMessageCount = await tx.chatRoomPinnedMessage.count({
        where: { roomId: id },
      });

      return { messageId, pinnedMessageCount, published: created.count > 0 };
    });

    if (result.published) {
      await publishChatRoomPinnedMessageRealtime({
        action: "pin",
        roomId: id,
        messageId,
        pinnedMessageCount: result.pinnedMessageCount,
      });
    }

    return ok(c, chatRoomPinnedMessageMutationSchema.parse(result));
  });
}
