import { createRoute } from "@hono/zod-openapi";

import { ensureMatchedChannelParticipant } from "@/helpers/chat-room-matched-membership.js";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminAddMatchedChannelParticipantBodySchema,
  adminMatchedChannelParticipantSchema,
  adminMatchedChannelRoomParamsSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "post",
  path: "/{roomId}/participants",
  operationId: "addAdminMatchedChannelParticipant",
  description:
    "Add an existing platform user to a live matched channel as a member (admin only). Idempotent when already a member. Publishes a joined membership status when newly added.",
  tags: ["Admin"],
  request: {
    params: adminMatchedChannelRoomParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: adminAddMatchedChannelParticipantBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminMatchedChannelParticipantSchema,
      "Member membership ensured",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { roomId } = c.req.valid("param");
    const { userId } = c.req.valid("json");

    const { result, statusMessages } = await prisma.$transaction(async (tx) =>
      ensureMatchedChannelParticipant(tx, { userId, roomId }),
    );

    for (const message of statusMessages) {
      await publishChatRoomMessageRealtime(message, "create");
    }

    return ok(
      c,
      adminMatchedChannelParticipantSchema.parse({
        userId: result.userId,
        roomId: result.roomId,
        access: result.access,
        outcome: result.outcome,
      }),
    );
  });
}
