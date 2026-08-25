import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import {
  deleteChatRoomMessageMetadataKeys,
  mergeChatRoomMessageMetadataKeys,
} from "@/helpers/chat-room-message-metadata-patch";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatRoomMessageSchema,
  removeChatRoomMessageUnfurlRequestSchema,
} from "@/schemas/chat-room.schema";

import {
  applyRemovedUnfurlToMetadata,
  chatRoomMessageInclude,
  mapChatRoomMessage,
  REMOVED_UNFURL_URLS_METADATA_KEY,
  readRemovedUnfurlUrlsFromMetadata,
  readUnfurlsFromMetadata,
  requireChatRoomUserWriteAccess,
} from "../../../../../helpers";
import { assertChatRoomContentMessage } from "../../../../../membership-status";

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
    path: "/{id}/messages/{messageId}/unfurls/remove",
    description:
      "Remove one unfurl card from a room message you authored. The URL in the body stays.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: removeChatRoomMessageUnfurlRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomMessageSchema,
        "Room message unfurl removed",
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
    const body = c.req.valid("json");

    let shouldPublish = false;
    const message = await prisma.$transaction(async (tx) => {
      await requireChatRoomUserWriteAccess(id, userContext.userId, tx);

      // Serialize per-card removes on the same message so two in-flight
      // clicks cannot each snapshot the old unfurls array and clobber the
      // other's removed URL (last-write-wins resurrection).
      const lockedMessages = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "chat_room_message"
        WHERE "id" = ${messageId}::uuid AND "roomId" = ${id}::uuid
        FOR UPDATE
      `;
      if (lockedMessages.length === 0) {
        throw notFound("Message not found");
      }

      const found = await tx.chatRoomMessage.findFirst({
        where: { id: messageId, roomId: id },
        include: chatRoomMessageInclude,
      });

      if (!found) {
        throw notFound("Message not found");
      }

      assertChatRoomContentMessage(found.metadata);

      if (found.senderCoworkerId) {
        throw forbidden("Coworker messages cannot have unfurls removed");
      }

      if (found.senderUserId !== userContext.userId) {
        throw forbidden("You can only remove unfurls from your own messages");
      }

      if (found.deletedAt != null) {
        throw forbidden("Deleted messages cannot be updated");
      }

      const applied = applyRemovedUnfurlToMetadata(found.metadata, body.url);
      if (applied.status === "not_found") {
        throw badRequest("Unfurl not found");
      }

      const nextMessage = {
        ...found,
        metadata: applied.metadata as Prisma.JsonValue,
      };

      if (applied.status === "already_removed") {
        return nextMessage;
      }

      const remaining = readUnfurlsFromMetadata(applied.metadata);
      const removedUrls = readRemovedUnfurlUrlsFromMetadata(applied.metadata);
      if (remaining) {
        await mergeChatRoomMessageMetadataKeys({
          client: tx,
          messageId,
          patch: {
            unfurls: remaining,
            [REMOVED_UNFURL_URLS_METADATA_KEY]: removedUrls,
          },
        });
      } else {
        await mergeChatRoomMessageMetadataKeys({
          client: tx,
          messageId,
          patch: { [REMOVED_UNFURL_URLS_METADATA_KEY]: removedUrls },
        });
        await deleteChatRoomMessageMetadataKeys({
          client: tx,
          messageId,
          keys: ["unfurls"],
        });
      }

      shouldPublish = true;
      return nextMessage;
    });

    if (shouldPublish) {
      await publishChatRoomMessageRealtime(message, "unfurl");
    }

    return ok(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(message, userContext.userId),
      ),
    );
  });
}
