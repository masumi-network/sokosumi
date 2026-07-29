import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { archivedChatRoomSchema } from "@/schemas/chat-room.schema";

import {
  canManageChatRoomLifecycle,
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
    path: "/{id}/archive",
    description:
      "Archive an organization chat room. Every read filters on archivedAt, so it disappears for all members while its messages stay in the database. Only the room creator or an organization owner/admin may archive. Direct rooms cannot be archived.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(archivedChatRoomSchema, "Room archived"),
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

    const archived = await prisma.$transaction(async (tx) => {
      // Access helper filters archivedAt: null. Concurrent archive still needs
      // a conditional write under the lock (parity with restore).
      const existing = await requireChatRoomUserAccess(
        id,
        userContext.userId,
        tx,
      );

      // A direct room's identity IS its participant set: `directKey` is
      // derived from it and creating a DM reopens one by that key alone.
      // Archiving one would leave the key resolving to a hidden row, so the
      // conversation could never be reopened. Same reasoning as patch.ts.
      if (existing.kind === "direct") {
        throw badRequest("Direct rooms cannot be archived.");
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
        throw badRequest("Room could not be archived.");
      }

      // Archiving hides the room for everyone — elevated authority only.
      const { role } = await resolveMemberOrganizationById({
        id: existing.organizationId,
        userId: userContext.userId,
        tx,
      });
      if (
        !canManageChatRoomLifecycle({
          createdByUserId: existing.createdByUserId,
          userId: userContext.userId,
          role,
        })
      ) {
        throw forbidden(
          "Only the room creator or an organization owner or admin can archive this room.",
        );
      }

      const archivedAt = new Date();
      const updated = await tx.chatRoom.updateMany({
        where: { id: existing.id, archivedAt: null },
        data: { archivedAt },
      });
      // Another txn may have archived under the lock after our access check.
      if (updated.count === 0) {
        throw notFound("Room not found");
      }

      return { id: existing.id, archivedAt };
    });

    return ok(
      c,
      archivedChatRoomSchema.parse({
        id: archived.id,
        archivedAt: archived.archivedAt,
      }),
    );
  });
}
