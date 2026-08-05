import { createRoute, z } from "@hono/zod-openapi";

import { mapChatRoomInvitation } from "@/helpers/chat-room-invitation";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomInvitationSchema } from "@/schemas/chat-room-invitation.schema";

import { requireRoomMemberCanInviteGuests } from "../../helpers";

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
    method: "get",
    path: "/{id}/invitations",
    description:
      "List pending guest invitations for an external channel. Caller must be a host-org room member (`access=member`).",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(chatRoomInvitationSchema),
        "Pending room invitations",
      ),
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
    const { id: roomId } = c.req.valid("param");

    const invitations = await prisma.$transaction(async (tx) => {
      const room = await requireRoomMemberCanInviteGuests(
        roomId,
        userContext.userId,
        tx,
      );

      const organizationId = room.organizationId;
      if (!organizationId) {
        throw badRequest("External channels require a host organization.");
      }

      const rows = await tx.chatRoomGuestInvitation.findMany({
        where: {
          roomId: room.id,
          status: "pending",
        },
        include: {
          inviter: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      });
      const organizationName = organization?.name ?? "";
      const roomName = room.name ?? "";

      return rows.map((row) =>
        mapChatRoomInvitation({
          id: row.id,
          roomId: room.id,
          roomName,
          organizationId,
          organizationName,
          email: row.email,
          status: row.status,
          inviter: {
            id: row.inviter.id,
            name: row.inviter.name,
          },
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
        }),
      );
    });

    return ok(c, invitations);
  });
}
