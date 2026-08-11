import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

import { requireRoomMemberCanInviteGuests } from "../../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  invitationId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "invitationId", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440010",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/invitations/{invitationId}",
    description:
      "Revoke a pending guest invitation for an external channel. Caller must be a host-org room member (`access=member`). Only pending invitations can be revoked.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      204: {
        description: "Invitation revoked",
      },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Invitation or room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id: roomId, invitationId } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      const room = await requireRoomMemberCanInviteGuests(
        roomId,
        userContext.userId,
        tx,
      );

      const updated = await tx.chatRoomGuestInvitation.updateMany({
        where: {
          id: invitationId,
          roomId: room.id,
          status: "pending",
        },
        data: {
          status: "revoked",
        },
      });

      if (updated.count === 0) {
        throw notFound("Invitation not found");
      }
    });

    return c.body(null, 204);
  });
}
