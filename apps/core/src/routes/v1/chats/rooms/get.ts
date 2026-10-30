import { createRoute, z } from "@hono/zod-openapi";
import { LIMITS } from "@/config/constants";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatRoomKindSchema,
  chatRoomListStatusSchema,
  chatRoomSchema,
} from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { chatRoomInclude, membershipVisibleActiveRoomWhere } from "./helpers";
import { mapSidebarRooms } from "./sidebar-rooms";

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

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List chat rooms visible to the current user: active-org membership rooms plus, in every workspace, Personal Directs (all-human, `organizationId` null), org-less matched channels and every external channel the caller is on, as a host-org member or a guest. With no active organization, the active-org rooms are the caller's org-less Directs: Personal Directs plus coworker and Soko Bot 1:1s of the personal workspace. Pass `status=archived` to list soft-archived membership rooms the caller may restore (organization owner/admin).",
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

    let organizationRole: string | null = null;
    if (organizationId) {
      const membership = await resolveMemberOrganizationById({
        id: organizationId,
        userId: userContext.userId,
        tx: prisma,
      });
      organizationRole = membership.role;
    }

    // Active: membership of caller AND (active-org rooms ∪ guest rooms ∪
    // Personal Directs ∪ org-less matched channels). No active org:
    // org-less Directs (incl. AI 1:1s) ∪ guest rooms ∪ matched-channel memberships.
    // Archived rooms are always org channels, so personal workspace returns
    // empty for status=archived. Archived list is OWNER/ADMIN only.
    const canManageAnyArchived =
      organizationRole != null && isOrganizationOwnerOrAdmin(organizationRole);
    if (
      (!organizationId && status === "archived") ||
      (status === "archived" && !canManageAnyArchived)
    ) {
      return ok(
        c,
        z.array(chatRoomSchema).parse([]),
        createPaginationMeta([], 0, take, false, cursor),
      );
    }

    const userId = userContext.userId;
    const where =
      status === "archived"
        ? {
            archivedAt: { not: null } as const,
            ...(kind ? { kind } : {}),
            userMembers: {
              some: { userId },
            },
            organizationId: organizationId as string,
          }
        : {
            ...(kind ? { kind } : {}),
            userMembers: {
              some: { userId },
            },
            ...membershipVisibleActiveRoomWhere(organizationId),
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

    // Message writes advance the stored timestamp used by both pagination
    // and room read responses.
    const paginationMeta = createPaginationMeta(
      rooms,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      await mapSidebarRooms(rooms, userId, organizationId),
      paginationMeta,
    );
  });
}
