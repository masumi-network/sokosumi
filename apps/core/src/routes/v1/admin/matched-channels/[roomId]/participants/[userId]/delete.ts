import { createRoute } from "@hono/zod-openapi";

import { removeMatchedChannelParticipant } from "@/helpers/chat-room-matched-membership.js";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime.js";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { publishChatMembershipRevoked } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminMatchedChannelParticipantParamsSchema,
  adminRemoveMatchedChannelParticipantSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "delete",
  path: "/{roomId}/participants/{userId}",
  operationId: "removeAdminMatchedChannelParticipant",
  description:
    "Remove a member from a live matched channel (admin only). May empty the roster. Publishes a left membership status and revokes realtime access.",
  tags: ["Admin"],
  request: {
    params: adminMatchedChannelParticipantParamsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminRemoveMatchedChannelParticipantSchema,
      "Member removed",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { roomId, userId } = c.req.valid("param");

    const { result, statusMessages } = await prisma.$transaction(async (tx) =>
      removeMatchedChannelParticipant(tx, { userId, roomId }),
    );

    const [statusResults, revokeResult] = await Promise.allSettled([
      Promise.all(
        statusMessages.map((message) =>
          publishChatRoomMessageRealtime(message, "create"),
        ),
      ),
      publishChatMembershipRevoked({
        userId: result.userId,
        roomId: result.roomId,
        reason: "removed",
      }),
    ]);
    if (statusResults.status === "rejected") {
      console.error(
        "Failed to publish chat membership status after matched remove",
        statusResults.reason,
      );
    }
    if (revokeResult.status === "rejected") {
      console.error(
        "Failed to publish chat membership revoke after matched remove",
        revokeResult.reason,
      );
    }

    return ok(
      c,
      adminRemoveMatchedChannelParticipantSchema.parse({
        userId: result.userId,
        roomId: result.roomId,
        outcome: result.outcome,
      }),
    );
  });
}
