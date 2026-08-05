import { createRoute, z } from "@hono/zod-openapi";

import {
  assertInviteeNotHostOrgMember,
  invitationExpiresAt,
  mapChatRoomInvitation,
  normalizeInvitationEmail,
} from "@/helpers/chat-room-invitation";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatRoomInvitationSchema,
  createChatRoomInvitationRequestSchema,
} from "@/schemas/chat-room-invitation.schema";

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
    method: "post",
    path: "/{id}/invitations",
    description:
      "Invite an external guest to an external channel by email. Caller must be a host-org room member (`access=member`). Rejects host-org member emails (they should self-join). Email send is wired in a follow-up task.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: createChatRoomInvitationRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        chatRoomInvitationSchema,
        "Room invitation created",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      409: jsonErrorResponse("Pending invitation already exists"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id: roomId } = c.req.valid("param");
    const body = c.req.valid("json");
    const email = normalizeInvitationEmail(body.email);

    const invitation = await prisma.$transaction(async (tx) => {
      const room = await requireRoomMemberCanInviteGuests(
        roomId,
        userContext.userId,
        tx,
      );

      if (!room.organizationId) {
        throw badRequest("External channels require a host organization.");
      }

      await assertInviteeNotHostOrgMember(room.organizationId, email, tx);

      const existingPending = await tx.chatRoomGuestInvitation.findFirst({
        where: {
          roomId: room.id,
          email,
          status: "pending",
        },
        select: { id: true },
      });
      if (existingPending) {
        throw badRequest(
          "A pending invitation already exists for this email in this room.",
        );
      }

      let createdInvitation;
      try {
        createdInvitation = await tx.chatRoomGuestInvitation.create({
          data: {
            roomId: room.id,
            email,
            inviterId: userContext.userId,
            status: "pending",
            expiresAt: invitationExpiresAt(),
          },
          include: {
            inviter: { select: { id: true, name: true } },
          },
        });
      } catch (error) {
        if (isPrismaUniqueViolation(error)) {
          throw badRequest(
            "A pending invitation already exists for this email in this room.",
          );
        }
        throw error;
      }

      const organization = await tx.organization.findUnique({
        where: { id: room.organizationId },
        select: { name: true },
      });

      return mapChatRoomInvitation({
        id: createdInvitation.id,
        roomId: room.id,
        roomName: room.name ?? "",
        organizationId: room.organizationId,
        organizationName: organization?.name ?? "",
        email: createdInvitation.email,
        status: createdInvitation.status,
        inviter: {
          id: createdInvitation.inviter.id,
          name: createdInvitation.inviter.name,
        },
        expiresAt: createdInvitation.expiresAt,
        createdAt: createdInvitation.createdAt,
      });
    });

    // Email notification: Task 9 (`renderChatRoomInvitationEmail` + send).
    return created(c, invitation);
  });
}
