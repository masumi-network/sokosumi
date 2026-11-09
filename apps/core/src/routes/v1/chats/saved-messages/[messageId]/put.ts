import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatSavedMessageMutationSchema } from "@/schemas/chat-room.schema";

import { requireChatRoomUserMembership } from "../../rooms/helpers";
import { assertChatRoomContentMessage } from "../../rooms/membership-status";
import { savedMessageParamsSchema } from "./params";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{messageId}",
    description:
      "Save a message for later on the reader's private Saved list. The reader must be a member of its room. Idempotent: saving again keeps the first save time.",
    tags: ["Chat Rooms"],
    request: { params: savedMessageParamsSchema },
    responses: {
      200: jsonSuccessResponse(chatSavedMessageMutationSchema, "Saved"),
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
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { messageId } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      const message = await tx.chatRoomMessage.findFirst({
        where: { id: messageId, deletedAt: null },
        select: { roomId: true, metadata: true },
      });
      if (!message) {
        throw notFound("Message not found");
      }
      await requireChatRoomUserMembership(message.roomId, userId, tx);
      assertChatRoomContentMessage(message.metadata);

      await tx.chatRoomSavedMessage.createMany({
        data: { userId, messageId },
        skipDuplicates: true,
      });
    });

    return ok(
      c,
      chatSavedMessageMutationSchema.parse({ messageId, saved: true }),
    );
  });
}
