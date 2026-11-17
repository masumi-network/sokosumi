import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { rewriteChatNotificationPreviews } from "@/helpers/chat-notification-fanout";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  BUZZ_BRIDGE_REPLAY_HEADER,
  isBridgeReplay,
} from "@/lib/buzz/bridge-replay";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  isCoworkerAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  chatRoomMessageSchema,
  updateChatRoomMessageRequestSchema,
} from "@/schemas/chat-room.schema";
import { requeueEditedChatMessageSignal } from "@/services/chat-message-signals.service";
import { scheduleChatRoomMessageUnfurls } from "@/services/chat-room-message-unfurl.service";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomCoworkerAccess,
  requireChatRoomUserWriteAccess,
  withChatRoomReplyCount,
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

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/{id}/messages/{messageId}",
    description: "Edit the content of a room message you authored.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: updateChatRoomMessageRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(chatRoomMessageSchema, "Room message updated"),
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
    // A Coworker edits only its own messages (a Buzz agent editing on Buzz).
    const coworkerId = isCoworkerAuthContext(c.var.authContext)
      ? c.var.authContext.coworkerId
      : null;
    const userContext = coworkerId
      ? null
      : requireUserAuthContext(c.var.authContext);
    const userId = userContext?.userId ?? null;
    const { id, messageId } = c.req.valid("param");
    const body = c.req.valid("json");

    let contentChanged = false;

    const message = await prisma.$transaction(async (tx) => {
      if (coworkerId) await requireChatRoomCoworkerAccess(id, coworkerId, tx);
      else if (userId) await requireChatRoomUserWriteAccess(id, userId, tx);

      const existing = await tx.chatRoomMessage.findFirst({
        where: {
          id: messageId,
          roomId: id,
        },
        include: chatRoomMessageInclude,
      });

      if (!existing) {
        throw notFound("Message not found");
      }

      assertChatRoomContentMessage(existing.metadata);

      if (coworkerId) {
        if (existing.senderCoworkerId !== coworkerId) {
          throw forbidden("A coworker can only edit its own messages");
        }
      } else if (existing.senderCoworkerId) {
        throw forbidden("Coworker messages cannot be edited");
      } else if (existing.senderUserId !== userId) {
        throw forbidden("You can only edit your own messages");
      }

      if (existing.deletedAt != null) {
        throw forbidden("Deleted messages cannot be edited");
      }

      // Written in the person's own Buzz app: only that app can change it on
      // Buzz, so editing it here would make the two disagree. Only the
      // bridge, replaying the app's own edits, may.
      if (
        userId &&
        !isBridgeReplay(userId, c.req.header(BUZZ_BRIDGE_REPLAY_HEADER)) &&
        (await tx.buzzMessageLink.count({
          where: { messageId: existing.id, signerPubkey: { not: null } },
        })) > 0
      ) {
        throw forbidden(
          "You wrote this message in the Buzz app. Edit it there.",
        );
      }

      if (existing.content === body.content) {
        return existing;
      }

      contentChanged = true;

      return tx.chatRoomMessage.update({
        where: { id: messageId },
        data: {
          content: body.content,
          editedAt: new Date(),
        },
        include: chatRoomMessageInclude,
      });
    });

    await publishChatRoomMessageRealtime(message, "update");

    if (contentChanged) {
      // The row would otherwise keep what the message used to say. The ids
      // come off the row: a uuid the caller wrote in capitals still matches
      // the message, and would match no notification.
      await rewriteChatNotificationPreviews({
        roomId: message.roomId,
        messageId: message.id,
      });
      waitUntil(scheduleChatRoomMessageUnfurls(message.id));
      waitUntil(requeueEditedChatMessageSignal(message.id));
    }

    return ok(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(
          await withChatRoomReplyCount(prisma, message),
          userId ?? undefined,
        ),
      ),
    );
  });
}
