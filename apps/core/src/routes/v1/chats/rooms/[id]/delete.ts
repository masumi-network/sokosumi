import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

import {
  canPermanentlyDeleteChatRoom,
  requireArchivedChatRoomUserAccess,
} from "../helpers";

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
    method: "delete",
    path: "/{id}",
    description:
      "Permanently delete a soft-archived organization chat room. Removes the room row and cascaded members, messages, and read states. Only an organization owner or admin may delete. The room must already be archived. Direct rooms cannot be deleted this way.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      204: {
        description: "Room permanently deleted",
      },
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      const existing = await requireArchivedChatRoomUserAccess(
        id,
        userContext.userId,
        tx,
      );

      if (existing.kind === "direct") {
        throw badRequest("Direct rooms cannot be permanently deleted.");
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
        throw badRequest("Room could not be deleted.");
      }

      const { role } = await resolveMemberOrganizationById({
        id: existing.organizationId,
        userId: userContext.userId,
        tx,
      });
      if (!canPermanentlyDeleteChatRoom({ role })) {
        throw forbidden(
          "Only an organization owner or admin can permanently delete this room.",
        );
      }

      const deleted = await tx.chatRoom.deleteMany({
        where: { id: existing.id, archivedAt: { not: null } },
      });
      if (deleted.count === 0) {
        throw notFound("Room not found");
      }
    });

    return c.body(null, 204);
  });
}
