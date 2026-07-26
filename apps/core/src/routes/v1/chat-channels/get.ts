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
import { chatChannelSchema } from "@/schemas/chat-channel.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import {
  chatChannelInclude,
  getChatChannelUnreadCounts,
  mapChatChannel,
} from "./helpers";

/**
 * Higher than the shared default because the sidebar renders the full list in
 * one pass: a page this size covers virtually every membership without a second
 * round trip, while still bounding the per-channel member/presence hydration.
 */
const CHANNEL_LIST_DEFAULT_LIMIT = 50;

const querySchema = cursorPaginationQuerySchema.extend({
  organizationId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "organizationId", in: "query" },
      example: "org_123",
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.MAX_PAGINATION_LIMIT)
    .default(CHANNEL_LIST_DEFAULT_LIMIT)
    .openapi({
      param: { name: "limit", in: "query" },
      description: `Number of channels to return (max ${LIMITS.MAX_PAGINATION_LIMIT})`,
      example: CHANNEL_LIST_DEFAULT_LIMIT,
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List organization chat channels visible to the current organization member.",
    tags: ["Chat Channels"],
    request: {
      query: querySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatChannelSchema),
        "List chat channels",
      ),
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
    const { organizationId } = queryParams;
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1;

    const { channels, unreadCounts, count, hasMore } =
      await prisma.$transaction(async (tx) => {
        await resolveMemberOrganizationById({
          id: organizationId,
          userId: userContext.userId,
          tx,
        });

        const where = {
          organizationId,
          archivedAt: null,
          userMembers: {
            some: { userId: userContext.userId },
          },
        };

        const [rows, count] = await Promise.all([
          tx.chatChannel.findMany({
            where,
            take: takePlusOne,
            skip,
            cursor: cursor ? { id: cursor } : undefined,
            include: chatChannelInclude,
            // `id` breaks ties so the cursor walk is a total order; `updatedAt`
            // alone is not unique and would drop or repeat rows across pages.
            orderBy: [
              { updatedAt: "desc" },
              { createdAt: "desc" },
              { id: "desc" },
            ],
          }),
          tx.chatChannel.count({ where }),
        ]);

        const hasMore = rows.length === takePlusOne;
        const channels = rows.slice(0, take);
        const unreadCounts = await getChatChannelUnreadCounts(
          channels.map((channel) => channel.id),
          userContext.userId,
          tx,
        );

        return { channels, unreadCounts, count, hasMore };
      });

    const paginationMeta = createPaginationMeta(
      channels,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      z
        .array(chatChannelSchema)
        .parse(
          channels.map((channel) =>
            mapChatChannel(
              channel,
              userContext.userId,
              unreadCounts.get(channel.id) ?? 0,
            ),
          ),
        ),
      paginationMeta,
    );
  });
}
