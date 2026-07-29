import { createRoute, z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { restoredChatRoomSchema } from "@/schemas/chat-room.schema";

import {
  mapChatRoom,
  requireArchivedChatRoomUserAccess,
  requireChatRoomUserAccess,
} from "../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/restore",
    description:
      "Restore a soft-archived organization chat room. Clears archivedAt so the room reappears for remaining members and frees its slug for normal use again. Any remaining human member may restore. Direct rooms cannot be restored because they cannot be archived.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(restoredChatRoomSchema, "Room restored"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const restored = await prisma.$transaction(async (tx) => {
      // Active-room helpers filter archivedAt: null — this path needs the
      // opposite. Membership is still required so only people who belonged
      // when it was archived (and stayed) can bring it back.
      const existing = await requireArchivedChatRoomUserAccess(
        id,
        userContext.userId,
        tx,
      );

      if (existing.kind === "direct") {
        throw badRequest("Direct rooms cannot be restored.");
      }

      if (!existing.organizationId) {
        throw badRequest("Organization rooms require an organization.");
      }

      const lockedRooms = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "chat_room"
        WHERE "id" = ${existing.id}::uuid
        FOR UPDATE
      `;
      if (lockedRooms.length === 0) {
        throw badRequest("Room could not be restored.");
      }

      // Concurrent restore may already have cleared archivedAt under the lock.
      const cleared = await tx.chatRoom.updateMany({
        where: { id: existing.id, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
      if (cleared.count === 0) {
        throw badRequest("Room is not archived.");
      }

      // Re-read via the active helper so the response matches a normal get.
      const live = await requireChatRoomUserAccess(
        existing.id,
        userContext.userId,
        tx,
      );
      return mapChatRoom(live, userContext.userId, 0);
    });

    return ok(c, restoredChatRoomSchema.parse(restored));
  });
}
