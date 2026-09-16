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
    method: "post",
    path: "/{id}/threads/{parentMessageId}/mute",
    description:
      "Mute one thread for the current user. Its replies stop counting toward room unread, stop making it an unread thread, and stop writing CHAT notifications; replies that name the user still do. Also looks the thread, so replies already waiting go quiet. Does not change whether the user Participates.",
    tags: ["Chat Rooms"],
    request: {
      params: chatRoomThreadMuteParamsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomThreadSchema, "Thread muted"),
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
      muted: true,
    });

    return ok(c, thread);
  });
}
