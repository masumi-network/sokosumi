import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomSchema } from "@/schemas/chat-room.schema";

import {
  mapChatRoomWithSidebarFlags,
  requireChatRoomUserAccess,
} from "../helpers";
import {
  getChatRoomUnreadCounts,
  getChatRoomUnreadMentionCounts,
  unreadAttention,
} from "../room-unread";

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
    method: "get",
    path: "/{id}",
    description: "Get an organization chat room.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Chat room retrieved"),
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

    // Avoid interactive transaction on this read-only path — pool contention
    // under parallel room-page loads caused P2028 "Unable to start a
    // transaction in the given time" (SOKOSUMI-Q9). Access check + unread
    // count do not need a shared snapshot.
    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );
    const [unreadCounts, unreadMentionCounts, organization] = await Promise.all(
      [
        getChatRoomUnreadCounts([room.id], userContext.userId, prisma),
        getChatRoomUnreadMentionCounts([room.id], userContext.userId, prisma),
        room.organizationId
          ? prisma.organization.findUnique({
              where: { id: room.organizationId },
              select: { name: true },
            })
          : Promise.resolve(null),
      ],
    );

    return ok(
      c,
      chatRoomSchema.parse(
        await mapChatRoomWithSidebarFlags(room, userContext.userId, prisma, {
          ...unreadAttention(unreadCounts.get(room.id)),
          unreadMentionCount: unreadMentionCounts.get(room.id) ?? 0,
          activeOrganizationId: userContext.organizationId,
          organizationName: organization?.name ?? null,
        }),
      ),
    );
  });
}
