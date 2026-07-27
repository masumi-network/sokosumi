import { createRoute, z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomKindSchema, chatRoomSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import {
  chatRoomInclude,
  getChatRoomUnreadCounts,
  mapChatRoom,
  requireActiveOrganizationId,
} from "./helpers";

/**
 * Higher than the shared default because the sidebar renders the full list in
 * one pass: a page this size covers virtually every membership without a second
 * round trip, while still bounding the per-room member/presence hydration.
 */
const ROOM_LIST_DEFAULT_LIMIT = 50;

const querySchema = cursorPaginationQuerySchema.extend({
  kind: chatRoomKindSchema.optional().openapi({
    param: { name: "kind", in: "query" },
    description: "Filter rooms by kind. Omit to list every room.",
    example: "channel",
  }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.MAX_PAGINATION_LIMIT)
    .default(ROOM_LIST_DEFAULT_LIMIT)
    .openapi({
      param: { name: "limit", in: "query" },
      description: `Number of rooms to return (max ${LIMITS.MAX_PAGINATION_LIMIT})`,
      example: ROOM_LIST_DEFAULT_LIMIT,
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List chat rooms in the active organization that are visible to the current organization member.",
    tags: ["Chat Rooms"],
    request: {
      query: querySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatRoomSchema),
        "List chat rooms",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Organization not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const organizationId = requireActiveOrganizationId(userContext);
    const queryParams = c.req.valid("query");
    const { kind } = queryParams;
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1;

    const { rooms, unreadCounts, count, hasMore } = await prisma.$transaction(
      async (tx) => {
        await resolveMemberOrganizationById({
          id: organizationId,
          userId: userContext.userId,
          tx,
        });

        const where = {
          organizationId,
          archivedAt: null,
          ...(kind ? { kind } : {}),
          userMembers: {
            some: { userId: userContext.userId },
          },
        };

        const [rows, count] = await Promise.all([
          tx.chatRoom.findMany({
            where,
            take: takePlusOne,
            skip,
            cursor: cursor ? { id: cursor } : undefined,
            include: chatRoomInclude,
            // `id` breaks ties so the cursor walk is a total order; `updatedAt`
            // alone is not unique and would drop or repeat rows across pages.
            orderBy: [
              { updatedAt: "desc" },
              { createdAt: "desc" },
              { id: "desc" },
            ],
          }),
          tx.chatRoom.count({ where }),
        ]);

        const hasMore = rows.length === takePlusOne;
        const rooms = rows.slice(0, take);
        const unreadCounts = await getChatRoomUnreadCounts(
          rooms.map((room) => room.id),
          userContext.userId,
          tx,
        );

        return { rooms, unreadCounts, count, hasMore };
      },
    );

    const paginationMeta = createPaginationMeta(
      rooms,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      z
        .array(chatRoomSchema)
        .parse(
          rooms.map((room) =>
            mapChatRoom(
              room,
              userContext.userId,
              unreadCounts.get(room.id) ?? 0,
            ),
          ),
        ),
      paginationMeta,
    );
  });
}
