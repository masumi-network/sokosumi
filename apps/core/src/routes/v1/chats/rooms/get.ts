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
import {
  chatRoomKindSchema,
  chatRoomListStatusSchema,
  chatRoomSchema,
} from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import {
  chatRoomInclude,
  getChatRoomLastMessageAts,
  getChatRoomSidebarFlags,
  getChatRoomUnreadCounts,
  getChatRoomUnreadMentionCounts,
  isOrganizationOwnerOrAdmin,
  mapChatRoom,
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
  status: chatRoomListStatusSchema.default("active").openapi({
    param: { name: "status", in: "query" },
    description:
      "Room visibility. `active` (default) lists live rooms; `archived` lists soft-archived channels the caller can restore (organization owner/admin, and still a member).",
    example: "active",
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
      "List chat rooms visible to the current user for the active organization only. With no active organization, lists personal coworker directs (`organizationId` null). Pass `status=archived` to list soft-archived membership rooms the caller may restore (organization owner/admin).",
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
    const queryParams = c.req.valid("query");
    const { kind, status } = queryParams;
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1;
    const organizationId = userContext.organizationId;

    // Avoid interactive transaction on this read-only path — chat index loads
    // listRooms in parallel with members + coworkers; interactive txs hold a
    // pool connection and also forbid Promise.all inside (#2559 / P2028).
    // Membership gate + list/count/unread do not need a shared snapshot.
    let organizationRole: string | null = null;
    if (organizationId) {
      const membership = await resolveMemberOrganizationById({
        id: organizationId,
        userId: userContext.userId,
        tx: prisma,
      });
      organizationRole = membership.role;
    }

    // Strict org match: active org → only that org's channels/directs.
    // No active org → personal coworker directs only. A kind=channel filter
    // with no org cannot match anything — return an empty page instead of
    // silently overriding the filter to directs. Archived rooms are always
    // org channels, so personal workspace returns empty for status=archived.
    // Archived list is OWNER/ADMIN only (same gate as restore).
    const canManageAnyArchived =
      organizationRole != null && isOrganizationOwnerOrAdmin(organizationRole);
    if (
      (!organizationId && kind === "channel") ||
      (!organizationId && status === "archived") ||
      (status === "archived" && !canManageAnyArchived)
    ) {
      return ok(
        c,
        z.array(chatRoomSchema).parse([]),
        createPaginationMeta([], 0, take, false, cursor),
      );
    }

    const where = {
      archivedAt: status === "archived" ? { not: null } : null,
      ...(kind ? { kind } : {}),
      userMembers: {
        some: { userId: userContext.userId },
      },
      ...(organizationId
        ? { organizationId }
        : {
            organizationId: null,
            kind: "direct" as const,
          }),
    };

    const [rows, count] = await Promise.all([
      prisma.chatRoom.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        include: chatRoomInclude,
        // `id` breaks ties so the cursor walk is a total order; `updatedAt`
        // alone is not unique and would drop or repeat rows across pages.
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
      prisma.chatRoom.count({ where }),
    ]);

    const hasMore = rows.length === takePlusOne;
    const rooms = rows.slice(0, take);
    const roomIds = rooms.map((room) => room.id);
    const [unreadCounts, unreadMentionCounts, lastMessageAts, sidebarFlags] =
      await Promise.all([
        getChatRoomUnreadCounts(roomIds, userContext.userId, prisma),
        getChatRoomUnreadMentionCounts(roomIds, userContext.userId, prisma),
        getChatRoomLastMessageAts(roomIds, prisma),
        getChatRoomSidebarFlags(roomIds, userContext.userId, prisma),
      ]);

    // Keep DB cursor order (`updatedAt` desc). Stream/message writes bump
    // room.updatedAt; do not re-sort by lastMessageAts after `take` — that
    // breaks cursor paging when membership exceeds one page.
    const paginationMeta = createPaginationMeta(
      rooms,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      z.array(chatRoomSchema).parse(
        rooms.map((room) => {
          const flags = sidebarFlags.get(room.id);
          return mapChatRoom(room, userContext.userId, {
            unreadCount: unreadCounts.get(room.id) ?? 0,
            unreadMentionCount: unreadMentionCounts.get(room.id) ?? 0,
            lastActivityAt: lastMessageAts.get(room.id) ?? room.updatedAt,
            pinnedAt: flags?.pinnedAt ?? null,
            mutedAt: flags?.mutedAt ?? null,
            markedUnread: flags?.markedUnread ?? false,
          });
        }),
      ),
      paginationMeta,
    );
  });
}
