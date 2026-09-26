import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomThreadSchema } from "@/schemas/chat-room.schema";

import {
  chatRoomThreadMuteParamsSchema,
  setThreadMuteAndReadBack,
} from "./handler";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/threads/{parentMessageId}/mute",
    description:
      "Unmute one thread for the current user. Later replies page them again by the normal Participant rule. Looks the thread when it was muted, so the silenced stretch stays read rather than arriving all at once. Two cases keep the look instead: a thread that was not muted, and a thread that named the user while it was muted, because that reply was never silenced.",
    tags: ["Chat Rooms"],
    request: {
      params: chatRoomThreadMuteParamsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomThreadSchema, "Thread unmuted"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Thread not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, parentMessageId } = c.req.valid("param");

    const thread = await setThreadMuteAndReadBack({
      roomId: id,
      userId: userContext.userId,
      parentMessageId,
      muted: false,
    });

    return ok(c, thread);
  });
}
