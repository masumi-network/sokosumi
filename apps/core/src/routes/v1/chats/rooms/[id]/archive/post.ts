import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import { badRequest, forbidden } from "@/helpers/error";
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

import { requireChatRoomUserAccess } from "../../helpers";

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
      "Archive an organization chat room. Every read filters on archivedAt, so it disappears for all members while its messages stay in the database. Only the room creator or an organization owner or admin can archive, and direct rooms cannot be archived.",
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
      // Filters on archivedAt: null, so archiving twice 404s rather than
      // moving the timestamp — the room is already gone either way.
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
        throw badRequest("Channel rooms require an organization.");
      }

      // Archiving hides the room for everyone, so it needs the same authority
      // as rewriting the roster rather than mere membership.
      const { role } = await resolveMemberOrganizationById({
        id: existing.organizationId,
        userId: userContext.userId,
        tx,
      });
      const canManageRoom =
        existing.createdByUserId === userContext.userId ||
        role === MemberRole.OWNER ||
        role === MemberRole.ADMIN;

      if (!canManageRoom) {
        throw forbidden(
          "Only the room creator or an organization owner or admin can archive this room.",
        );
      }

      return tx.chatRoom.update({
        where: { id: existing.id },
        data: { archivedAt: new Date() },
        select: { id: true, archivedAt: true },
      });
    });

    // `update` cannot clear the value we just set, but the column is nullable
    // so narrow it rather than asserting.
    if (!archived.archivedAt) {
      throw badRequest("Room could not be archived.");
    }

    return ok(
      c,
      archivedChatRoomSchema.parse({
        id: archived.id,
        archivedAt: archived.archivedAt,
      }),
    );
  });
}
