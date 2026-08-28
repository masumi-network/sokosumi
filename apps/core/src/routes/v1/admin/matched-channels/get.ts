import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminMatchedChannelOptionListSchema } from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminMatchedChannels",
  description:
    "List live org-less matched channels (`discoverability=matched`, admin only).",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      adminMatchedChannelOptionListSchema,
      "Live matched channels",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const rooms = await prisma.chatRoom.findMany({
      where: {
        organizationId: null,
        kind: "channel",
        discoverability: "matched",
        archivedAt: null,
      },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });

    const channels = rooms.flatMap((room) =>
      room.slug ? [{ id: room.id, name: room.name, slug: room.slug }] : [],
    );

    return ok(c, adminMatchedChannelOptionListSchema.parse(channels));
  });
}
