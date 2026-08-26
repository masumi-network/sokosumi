import { createRoute, z } from "@hono/zod-openapi";

import {
  publishChatRoomMessageRealtime,
  publishChatRoomMessageRealtimeById,
} from "@/helpers/chat-room-message-realtime";
import { publishChatRoomPinnedMessageRealtime } from "@/helpers/chat-room-pinned-message-realtime";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserMembership,
} from "../../../helpers";
import { assertChatRoomContentMessage } from "../../../membership-status";

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
    method: "delete",
    path: "/{id}/messages/{messageId}",
    description:
      "Soft-delete a room message the current user authored. Idempotent for already-deleted messages.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomMessageSchema,
        "Room message soft-deleted",
      ),
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

    const { message, newlySoftDeleted, unpinned } = await prisma.$transaction(
      async (tx) => {
        await requireChatRoomUserMembership(id, userContext.userId, tx);

        const existing = await tx.chatRoomMessage.findFirst({
          where: { id: messageId, roomId: id },
          include: chatRoomMessageInclude,
        });
        if (!existing) {
          throw notFound("Message not found");
        }

        assertChatRoomContentMessage(existing.metadata);

        if (existing.senderUserId !== userContext.userId) {
          throw forbidden("You can only delete your own messages");
        }

        if (existing.deletedAt != null) {
          // Already tombstoned — still cancel any non-terminal coworker
          // mentions so a late waitUntil cannot revive work against it.
          await tx.chatRoomMention.updateMany({
            where: {
              messageId,
              status: { in: ["pending", "sent"] },
            },
            data: {
              status: "failed",
              error: "Source message was deleted",
            },
          });
          return {
            message: existing,
            newlySoftDeleted: false,
            unpinned: null,
          };
        }

        // Conditional write so concurrent DELETEs cannot both claim the
        // tombstone transition (and double-publish parent reply counts).
        const softDelete = await tx.chatRoomMessage.updateMany({
          where: {
            id: messageId,
            roomId: id,
            deletedAt: null,
          },
          data: {
            deletedAt: new Date(),
            content: "",
            metadata: null,
          },
        });
        const newlySoftDeleted = softDelete.count === 1;

        // Soft-delete must stop coworker dispatch: otherwise waitUntil still
        // burns credits and can post a reply under a wiped tombstone.
        await tx.chatRoomMention.updateMany({
          where: {
            messageId,
            status: { in: ["pending", "sent"] },
          },
          data: {
            status: "failed",
            error: "Source message was deleted",
          },
        });

        const updated = await tx.chatRoomMessage.findFirst({
          where: { id: messageId, roomId: id },
          include: chatRoomMessageInclude,
        });
        if (!updated) {
          throw notFound("Message not found");
        }

        const pinDelete = newlySoftDeleted
          ? await tx.chatRoomPinnedMessage.deleteMany({
              where: { roomId: id, messageId },
            })
          : { count: 0 };
        const pinnedMessageCount = newlySoftDeleted
          ? await tx.chatRoomPinnedMessage.count({ where: { roomId: id } })
          : 0;

        return {
          message: updated,
          newlySoftDeleted,
          unpinned: pinDelete.count > 0 ? { pinnedMessageCount } : null,
        };
      },
    );

    // Soft-deleted replies drop out of parent threadReplyCount — re-publish
    // the parent so room timeline / open-thread header stay in sync.
    // Independent of the reply delete event; publish in parallel to cut DELETE latency.
    const publishes: Array<Promise<void>> = [
      publishChatRoomMessageRealtime(message, "delete"),
    ];
    if (newlySoftDeleted && message.parentMessageId != null) {
      publishes.push(
        publishChatRoomMessageRealtimeById(message.parentMessageId, "update"),
      );
    }
    await Promise.all(publishes);

    if (unpinned) {
      await publishChatRoomPinnedMessageRealtime({
        action: "unpin",
        roomId: id,
        messageId,
        pinnedMessageCount: unpinned.pinnedMessageCount,
      });
    }

    return ok(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(message, userContext.userId),
      ),
    );
  });
}
