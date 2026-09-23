import { createRoute, z } from "@hono/zod-openapi";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { parseCursorPagination } from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatUnreadThreadSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import { membershipVisibleActiveRoomWhere } from "../../rooms/helpers";
import { listUnreadThreadsAcrossRooms } from "../../rooms/room-unread";

const querySchema = cursorPaginationQuerySchema.extend({
  cursor: z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      description:
        "The last Thread's `parentMessageId` from the previous page (`nextCursor`).",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/unread",
    description:
      "The current user's unread Threads across every room the sidebar lists for them, less rooms they muted. Newest unread reply first. Same Participant- and mute-gated eligibility as each room's threadUnreadCount, so the Threads view lists exactly what the rooms count (SOK-1159, ADR-0037).",
    tags: ["Chat Rooms"],
    request: {
      query: querySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatUnreadThreadSchema),
        "Unread Threads across rooms",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const queryParams = c.req.valid("query");
    const { cursor, take } = parseCursorPagination(queryParams);
    const userId = userContext.userId;

    // The rooms the sidebar lists, less the ones the reader muted: room mute
    // outranks everything a room holds, so the sidebar shows no Thread of a
    // muted room and neither may this list.
    const rooms = await prisma.chatRoom.findMany({
      where: {
        ...membershipVisibleActiveRoomWhere(userId, userContext.organizationId),
        userMembers: { some: { userId, mutedAt: null } },
      },
      select: { id: true },
    });

    const page = await listUnreadThreadsAcrossRooms(
      rooms.map((room) => room.id),
      userId,
      prisma,
      { cursor, limit: take },
    );

    return ok(c, z.array(chatUnreadThreadSchema).parse(page.threads), {
      cursor: cursor ?? null,
      limit: take,
      total: page.total,
      nextCursor: page.nextCursor,
    });
  });
}
