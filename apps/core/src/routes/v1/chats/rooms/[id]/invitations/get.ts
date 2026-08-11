import { createRoute, z } from "@hono/zod-openapi";

import {
  expireStalePendingInvitations,
  livePendingInvitationWhere,
  mapChatRoomInvitationFromRecord,
} from "@/helpers/chat-room-invitation";
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

    // Read-only GET: no interactive transaction (pool / P2028 — apps/core AGENTS.md).
    const room = await requireRoomMemberCanInviteGuests(
      roomId,
      userContext.userId,
      prisma,
    );

    const organizationId = room.organizationId;
    if (!organizationId) {
      throw badRequest("External channels require a host organization.");
    }

    // Intentional write-on-GET: lazy-expire past-due pending so host list
    // matches invitee + rate-limit caps. Cron also expires daily; create path
    // expires before counting. List still filters via livePendingInvitationWhere.
    await expireStalePendingInvitations(prisma, { roomId: room.id });

    const [rows, organization] = await Promise.all([
      prisma.chatRoomGuestInvitation.findMany({
        where: livePendingInvitationWhere(room.id),
        include: {
          inviter: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
    ]);

    const roomContext = {
      id: room.id,
      name: room.name,
      organizationId,
      organizationName: organization?.name,
    };

    const invitations = rows.map((row) =>
      mapChatRoomInvitationFromRecord(row, roomContext),
    );

    return ok(c, invitations);
  });
}
