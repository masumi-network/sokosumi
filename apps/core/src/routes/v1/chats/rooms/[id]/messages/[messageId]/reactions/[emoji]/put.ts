import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";

import {
  chatRoomMessageReactionParamsSchema,
  setChatRoomMessageReaction,
} from "./handler";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{id}/messages/{messageId}/reactions/{emoji}",
    description:
      "Add the current user's emoji Reaction to a room message. Idempotent if it already exists.",
    tags: ["Chat Rooms"],
    request: {
      params: chatRoomMessageReactionParamsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomMessageSchema, "Reaction added"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Message not found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, messageId, emoji } = c.req.valid("param");

    const message = await setChatRoomMessageReaction({
      roomId: id,
      messageId,
      userId: userContext.userId,
      emoji,
      reacted: true,
    });

    return ok(c, message);
  });
}
