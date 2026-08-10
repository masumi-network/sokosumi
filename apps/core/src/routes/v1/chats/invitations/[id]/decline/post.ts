import { createRoute, z } from "@hono/zod-openapi";

import {
  mapChatRoomInvitationFromRecord,
  normalizeInvitationEmail,
} from "@/helpers/chat-room-invitation";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomInvitationSchema } from "@/schemas/chat-room-invitation.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440010",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/decline",
    description:
      "Decline a pending room invitation. Caller email must match the invitee. Idempotent when already declined.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomInvitationSchema, "Invitation declined"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Invitation not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const now = new Date();

    const invitation = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userContext.userId },
        select: { email: true },
      });
      if (!user) {
        throw notFound("User not found");
      }
      const email = normalizeInvitationEmail(user.email);

      const row = await tx.chatRoomGuestInvitation.findUnique({
        where: { id },
        include: {
          inviter: { select: { id: true, name: true } },
          room: {
            select: {
              id: true,
              name: true,
              organizationId: true,
              organization: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!row || normalizeInvitationEmail(row.email) !== email) {
        throw notFound("Invitation not found");
      }
      if (!row.room.organizationId) {
        throw notFound("Invitation not found");
      }

      if (row.status === "declined") {
        return mapChatRoomInvitationFromRecord(
          row,
          {
            id: row.room.id,
            name: row.room.name,
            organizationId: row.room.organizationId,
            organizationName: row.room.organization?.name,
          },
          { status: "declined" },
        );
      }

      if (row.status !== "pending") {
        throw badRequest("Invitation is no longer pending.");
      }

      if (row.expiresAt <= now) {
        await tx.chatRoomGuestInvitation.update({
          where: { id: row.id },
          data: { status: "expired" },
        });
        throw badRequest("Invitation has expired.");
      }

      const updated = await tx.chatRoomGuestInvitation.update({
        where: { id: row.id },
        data: { status: "declined" },
        include: {
          inviter: { select: { id: true, name: true } },
          room: {
            select: {
              id: true,
              name: true,
              organizationId: true,
              organization: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!updated.room.organizationId) {
        throw notFound("Invitation not found");
      }

      return mapChatRoomInvitationFromRecord(updated, {
        id: updated.room.id,
        name: updated.room.name,
        organizationId: updated.room.organizationId,
        organizationName: updated.room.organization?.name,
      });
    });

    return ok(c, invitation);
  });
}
