import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminMatchedChannelListQuerySchema,
  adminMatchedChannelOptionListSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminMatchedChannels",
  description:
    "List org-less matched channels (`discoverability=matched`, admin only). Defaults to live channels (`status=active`); pass `status=archived` for soft-archived channels.",
  tags: ["Admin"],
  request: {
    query: adminMatchedChannelListQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminMatchedChannelOptionListSchema,
      "Matched channels",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { status } = c.req.valid("query");

    const rooms = await prisma.chatRoom.findMany({
      where: {
        organizationId: null,
        kind: "channel",
        discoverability: "matched",
        archivedAt: status === "archived" ? { not: null } : null,
      },
      select: { id: true, name: true, slug: true, archivedAt: true },
      orderBy: { name: "asc" },
    });

    const channels = rooms.flatMap((room) =>
      room.slug
        ? [
            {
              id: room.id,
              name: room.name,
              slug: room.slug,
              archivedAt: room.archivedAt,
            },
          ]
        : [],
    );

    return ok(c, adminMatchedChannelOptionListSchema.parse(channels));
  });
}
