import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { markLookedThreadReplyRowsRead } from "@/helpers/chat-thread-reply-notifications";
import { cancelNotificationEmails } from "@/helpers/notification-email-dispatch";
import { publishClearedNotifications } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomThreadsMarkAllSchema } from "@/schemas/chat-room.schema";

import { requireChatRoomUserAccess } from "../../../helpers";
import { markAllChatRoomThreadsRead } from "../../../room-unread";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/threads/read",
    description:
      "Mark every unread Thread the current user Participates in for this room (Look). Upserts ChatRoomThreadReadState and clears the mention and direct-message notifications for replies in Threads the user Participates in that those looks cover. Does not change room read state. Does not Look lurker Threads.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomThreadsMarkAllSchema,
        "Unread threads marked looked",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );
    const { markedCount, clearedRows } = await prisma.$transaction(
      async (tx) => {
        const markedCount = await markAllChatRoomThreadsRead(
          room.id,
          userContext.userId,
          tx,
        );
        // The Looks are what read these Threads, so they clear the Threads'
        // rows (SOK-1217). Lurker and muted Threads were not Looked and keep
        // theirs.
        const clearedRows = await markLookedThreadReplyRowsRead(
          room.id,
          userContext.userId,
          tx,
        );
        return { markedCount, clearedRows };
      },
    );
    waitUntil(publishClearedNotifications(clearedRows.map((row) => row.id)));
    waitUntil(cancelNotificationEmails(clearedRows));

    return ok(c, chatRoomThreadsMarkAllSchema.parse({ markedCount }));
  });
}
