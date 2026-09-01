import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminMatchedChannelOptionSchema,
  adminMatchedChannelRoomParamsSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "post",
  path: "/{roomId}/restore",
  operationId: "restoreAdminMatchedChannel",
  description:
    "Restore a soft-archived org-less matched channel (admin only). Clears archivedAt so the room returns to the live hub list. Memberships are kept; members regain access on their next session refresh. Does not require an organization.",
  tags: ["Admin"],
  request: {
    params: adminMatchedChannelRoomParamsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminMatchedChannelOptionSchema,
      "Matched channel restored",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { roomId } = c.req.valid("param");

    const restored = await prisma.$transaction(async (tx) => {
      const lockedRooms = await tx.$queryRaw<
        Array<{
          id: string;
          organizationId: string | null;
          kind: string;
          discoverability: string | null;
          archivedAt: Date | null;
          name: string;
          slug: string | null;
        }>
      >`
        SELECT "id", "organizationId", "kind", "discoverability", "archivedAt",
               "name", "slug"
        FROM "chat_room"
        WHERE "id" = ${roomId}::uuid
        FOR UPDATE
      `;
      const room = lockedRooms[0];
      if (
        !room ||
        room.organizationId !== null ||
        room.kind !== "channel" ||
        room.discoverability !== "matched" ||
        room.archivedAt === null ||
        !room.slug
      ) {
        throw notFound("Room not found");
      }

      const updated = await tx.chatRoom.updateMany({
        where: { id: room.id, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
      if (updated.count === 0) {
        throw notFound("Room not found");
      }

      return {
        id: room.id,
        name: room.name,
        slug: room.slug,
        archivedAt: null,
      };
    });

    return ok(c, adminMatchedChannelOptionSchema.parse(restored));
  });
}
