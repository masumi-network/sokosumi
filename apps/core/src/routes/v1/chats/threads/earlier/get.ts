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
import { chatEarlierThreadSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import { listEarlierThreadsAcrossRooms } from "../../rooms/room-unread";
import { readerThreadRoomIds } from "../reader-thread-rooms";

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
    path: "/earlier",
    description:
      "The current user's Threads with nothing unread, across the rooms the sidebar lists for them less rooms they muted: the Participant Threads (ADR-0013) that `GET /chats/threads/unread` leaves out. Newest reply first. The Threads view's Earlier group (SOK-1159).",
    tags: ["Chat Rooms"],
    request: {
      query: querySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatEarlierThreadSchema),
        "Read Threads across rooms",
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
    const { cursor, take } = parseCursorPagination(c.req.valid("query"));
    const userId = userContext.userId;

    const page = await listEarlierThreadsAcrossRooms(
      await readerThreadRoomIds(userId, userContext.organizationId),
      userId,
      prisma,
      { cursor, limit: take },
    );

    return ok(c, z.array(chatEarlierThreadSchema).parse(page.threads), {
      cursor: cursor ?? null,
      limit: take,
      total: page.total,
      nextCursor: page.nextCursor,
    });
  });
}
