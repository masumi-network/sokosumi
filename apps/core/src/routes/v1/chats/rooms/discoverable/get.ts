import { createRoute, z } from "@hono/zod-openapi";

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
import { discoverableChatRoomSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import { requireActiveOrganizationId } from "../helpers";

const querySchema = cursorPaginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .openapi({
      param: { name: "q", in: "query" },
      description:
        "Filter by channel name or slug (case-insensitive contains).",
      example: "launch",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/discoverable",
    description:
      "List active public or external (`discoverability` in `public` | `external`) channels in the active organization that the caller is not already a member of. Requires an active organization. Optional `q` filters by name or slug.",
    tags: ["Chat Rooms"],
    request: {
      query: querySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(discoverableChatRoomSchema),
        "Discoverable public and external channels",
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
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1;
    const q = queryParams.q;

    await resolveMemberOrganizationById({
      id: organizationId,
      userId: userContext.userId,
      tx: prisma,
    });

    const where = {
      organizationId,
      kind: "channel" as const,
      discoverability: { in: ["public", "external"] },
      archivedAt: null,
      userMembers: {
        none: { userId: userContext.userId },
      },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { slug: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, count] = await Promise.all([
      prisma.chatRoom.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        select: {
          id: true,
          name: true,
          slug: true,
          topic: true,
          discoverability: true,
          createdByUserId: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { userMembers: true },
          },
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      prisma.chatRoom.count({ where }),
    ]);

    const hasMore = rows.length === takePlusOne;
    const rooms = rows.slice(0, take);
    const paginationMeta = createPaginationMeta(
      rooms,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      z.array(discoverableChatRoomSchema).parse(
        rooms.map((room) => ({
          id: room.id,
          name: room.name,
          slug: room.slug,
          topic: room.topic,
          discoverability:
            room.discoverability === "external" ? "external" : "public",
          memberCount: room._count.userMembers,
          createdByUserId: room.createdByUserId,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
        })),
      ),
      paginationMeta,
    );
  });
}
