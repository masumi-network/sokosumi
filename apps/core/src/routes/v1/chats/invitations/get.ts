import { createRoute, z } from "@hono/zod-openapi";

import {
  mapChatRoomInvitation,
  normalizeInvitationEmail,
} from "@/helpers/chat-room-invitation";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatRoomInvitationSchema,
  chatRoomInvitationStatusSchema,
} from "@/schemas/chat-room-invitation.schema";

const querySchema = z.object({
  status: chatRoomInvitationStatusSchema.default("pending").openapi({
    param: { name: "status", in: "query" },
    description:
      "Invitation status filter. Defaults to `pending`. Pending results exclude expired invites.",
    example: "pending",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List chat-room invitations for the signed-in user (email match, normalized). Defaults to pending invites that have not expired. Used by the External sidebar.",
    tags: ["Chat Rooms"],
    request: {
      query: querySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(chatRoomInvitationSchema),
        "Room invitations for the invitee",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { status } = c.req.valid("query");
    const now = new Date();

    const invitations = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userContext.userId },
        select: { email: true },
      });
      if (!user) {
        throw notFound("User not found");
      }
      const email = normalizeInvitationEmail(user.email);

      const rows = await tx.chatRoomGuestInvitation.findMany({
        where: {
          email,
          status,
          ...(status === "pending" ? { expiresAt: { gt: now } } : {}),
          room: {
            archivedAt: null,
          },
        },
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
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      return rows.flatMap((row) => {
        const organizationId = row.room.organizationId;
        if (!organizationId) {
          return [];
        }
        return [
          mapChatRoomInvitation({
            id: row.id,
            roomId: row.room.id,
            roomName: row.room.name ?? "",
            organizationId,
            organizationName: row.room.organization?.name ?? "",
            email: row.email,
            status: row.status,
            inviter: {
              id: row.inviter.id,
              name: row.inviter.name,
            },
            expiresAt: row.expiresAt,
            createdAt: row.createdAt,
          }),
        ];
      });
    });

    return ok(c, invitations);
  });
}
