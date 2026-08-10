import { createRoute, z } from "@hono/zod-openapi";

import {
  mapChatRoomInvitationFromRecord,
  normalizeInvitationEmail,
} from "@/helpers/chat-room-invitation";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
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

import { recordChannelMembershipStatus } from "../../../rooms/membership-status";

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
    path: "/{id}/accept",
    description:
      "Accept a pending room invitation. Creates `ChatRoomUserMember` with `access=guest` and a read state (no org Member / seat). Caller email must match the invitee. Rejects when the caller is already a host-org member. Idempotent when already a guest on the room.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomInvitationSchema,
        "Invitation accepted; guest membership ensured",
      ),
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

    const { invitation, statusMessages } = await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userContext.userId },
          select: { email: true, name: true },
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
                kind: true,
                discoverability: true,
                archivedAt: true,
                organizationId: true,
                organization: { select: { id: true, name: true } },
              },
            },
          },
        });

        if (!row || normalizeInvitationEmail(row.email) !== email) {
          throw notFound("Invitation not found");
        }

        const room = row.room;
        if (!room.organizationId) {
          throw notFound("Invitation not found");
        }

        const existingMembership = await tx.chatRoomUserMember.findUnique({
          where: {
            roomId_userId: {
              roomId: room.id,
              userId: userContext.userId,
            },
          },
          select: { access: true },
        });

        // Idempotent: already guest on the room — ensure invitation accepted.
        if (existingMembership?.access === "guest") {
          let status = row.status;
          if (status === "pending") {
            await tx.chatRoomGuestInvitation.update({
              where: { id: row.id },
              data: {
                status: "accepted",
                acceptedAt: now,
                acceptedByUserId: userContext.userId,
              },
            });
            status = "accepted";
          }
          return {
            invitation: mapChatRoomInvitationFromRecord(
              row,
              {
                id: room.id,
                name: room.name,
                organizationId: room.organizationId,
                organizationName: room.organization?.name,
              },
              { status },
            ),
            statusMessages: [] as Awaited<
              ReturnType<typeof recordChannelMembershipStatus>
            >,
          };
        }

        if (existingMembership) {
          throw badRequest("Already a member of this room.");
        }

        // Leave / host-remove after accept does not revive membership via the
        // same invitation. Host must send a new invite.
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

        // Lock room before guest membership so convert-off-external cannot race
        // past the discoverability check and leave guests on non-external rooms.
        await tx.$queryRaw`
          SELECT "id" FROM "chat_room"
          WHERE "id" = ${room.id}::uuid
          FOR UPDATE
        `;
        const lockedRoom = await tx.chatRoom.findUnique({
          where: { id: room.id },
          select: {
            archivedAt: true,
            kind: true,
            discoverability: true,
          },
        });
        if (
          !lockedRoom ||
          lockedRoom.archivedAt !== null ||
          lockedRoom.kind !== "channel" ||
          lockedRoom.discoverability !== "external"
        ) {
          throw badRequest(
            "Room is no longer available for guest invitations.",
          );
        }

        const hostMember = await tx.member.findUnique({
          where: {
            userId_organizationId: {
              userId: userContext.userId,
              organizationId: room.organizationId,
            },
          },
          select: { id: true },
        });
        if (hostMember) {
          throw badRequest(
            "User is already an organization member; they can join the channel directly.",
          );
        }

        // Upsert so concurrent double-accept on the unique (roomId, userId)
        // does not 500; create path is the normal case after the null check.
        await tx.chatRoomUserMember.upsert({
          where: {
            roomId_userId: {
              roomId: room.id,
              userId: userContext.userId,
            },
          },
          create: {
            roomId: room.id,
            userId: userContext.userId,
            access: "guest",
          },
          update: {
            access: "guest",
          },
        });
        await tx.chatRoomReadState.createMany({
          data: [{ roomId: room.id, userId: userContext.userId }],
          skipDuplicates: true,
        });

        await tx.chatRoomGuestInvitation.update({
          where: { id: row.id },
          data: {
            status: "accepted",
            acceptedAt: now,
            acceptedByUserId: userContext.userId,
          },
        });

        const actorName = user.name?.trim() || "Someone";
        const statusMessages = await recordChannelMembershipStatus(tx, {
          roomId: room.id,
          roomKind: room.kind,
          changes: [
            {
              action: "joined",
              subject: {
                type: "user",
                id: userContext.userId,
                name: actorName,
              },
            },
          ],
        });

        return {
          invitation: mapChatRoomInvitationFromRecord(
            row,
            {
              id: room.id,
              name: room.name,
              organizationId: room.organizationId,
              organizationName: room.organization?.name,
            },
            { status: "accepted" },
          ),
          statusMessages,
        };
      },
    );

    for (const message of statusMessages) {
      await publishChatRoomMessageRealtime(message, "create");
    }

    return ok(c, invitation);
  });
}
