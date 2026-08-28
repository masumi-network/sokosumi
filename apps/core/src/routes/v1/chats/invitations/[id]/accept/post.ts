import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { joinExternalChannelAsGuest } from "@/helpers/chat-room-guest-membership";
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
import {
  CHAT_ROOM_INVITATION_STATUS,
  chatRoomInvitationSchema,
} from "@/schemas/chat-room-invitation.schema";

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

/**
 * Idempotent pending→accepted for an already-guest accept. Rejects expired
 * pending rows so a second invite cannot flip to accepted after expiresAt.
 * Returns the best-known status from this attempt; callers must re-read when
 * the result is still pending after a create race (beforeCreate may have
 * accepted already).
 */
async function acceptPendingInvitationIfNeeded(
  tx: Prisma.TransactionClient,
  args: {
    invitationId: string;
    userId: string;
    status: string;
    expiresAt: Date;
    now: Date;
  },
): Promise<string> {
  let status = args.status;
  if (status !== CHAT_ROOM_INVITATION_STATUS.PENDING) {
    return status;
  }
  if (args.expiresAt <= args.now) {
    await tx.chatRoomGuestInvitation.updateMany({
      where: {
        id: args.invitationId,
        status: CHAT_ROOM_INVITATION_STATUS.PENDING,
      },
      data: { status: CHAT_ROOM_INVITATION_STATUS.EXPIRED },
    });
    throw badRequest("Invitation has expired.");
  }
  const accepted = await tx.chatRoomGuestInvitation.updateMany({
    where: {
      id: args.invitationId,
      status: CHAT_ROOM_INVITATION_STATUS.PENDING,
      expiresAt: { gt: args.now },
    },
    data: {
      status: CHAT_ROOM_INVITATION_STATUS.ACCEPTED,
      acceptedAt: args.now,
      acceptedByUserId: args.userId,
    },
  });
  if (accepted.count > 0) {
    status = CHAT_ROOM_INVITATION_STATUS.ACCEPTED;
  }
  return status;
}

async function resolveInvitationStatusAfterJoin(
  tx: Prisma.TransactionClient,
  args: {
    invitationId: string;
    userId: string;
    rowStatus: string;
    expiresAt: Date;
    now: Date;
    outcome: "joined" | "already_guest" | "aborted";
  },
): Promise<string> {
  if (args.outcome === "aborted") {
    throw badRequest("Invitation is no longer pending.");
  }
  if (args.outcome === "joined") {
    return CHAT_ROOM_INVITATION_STATUS.ACCEPTED;
  }

  let status = await acceptPendingInvitationIfNeeded(tx, {
    invitationId: args.invitationId,
    userId: args.userId,
    status: args.rowStatus,
    expiresAt: args.expiresAt,
    now: args.now,
  });

  // Create unique-race as guest: beforeCreate already accepted, but the
  // in-memory row is still pending and updateMany matched 0 rows.
  if (status === CHAT_ROOM_INVITATION_STATUS.PENDING) {
    const fresh = await tx.chatRoomGuestInvitation.findUnique({
      where: { id: args.invitationId },
      select: { status: true },
    });
    if (fresh) {
      status = fresh.status;
    }
  }

  return status;
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const now = new Date();

    const { invitation, statusMessages } = await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userContext.userId },
          select: { email: true },
        });
        if (!user) {
          throw notFound("User not found");
        }
        const email = normalizeInvitationEmail(user.email);

        // Lock invitation before status decisions so revoke/decline cannot
        // commit after a stale pending read and still lose to accept.
        await tx.$queryRaw`
          SELECT "id" FROM "chat_room_guest_invitation"
          WHERE "id" = ${id}::uuid
          FOR UPDATE
        `;

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

        const room = row.room;
        if (!room.organizationId) {
          throw notFound("Invitation not found");
        }

        const { result, statusMessages: joinStatusMessages } =
          await joinExternalChannelAsGuest(tx, {
            userId: userContext.userId,
            roomId: room.id,
            roomUnavailableMessage:
              "Room is no longer available for guest invitations.",
            beforeCreate: async () => {
              // Leave / host-remove after accept does not revive membership via
              // the same invitation. Host must send a new invite.
              if (row.status !== CHAT_ROOM_INVITATION_STATUS.PENDING) {
                throw badRequest("Invitation is no longer pending.");
              }
              if (row.expiresAt <= now) {
                await tx.chatRoomGuestInvitation.updateMany({
                  where: {
                    id: row.id,
                    status: CHAT_ROOM_INVITATION_STATUS.PENDING,
                  },
                  data: { status: CHAT_ROOM_INVITATION_STATUS.EXPIRED },
                });
                throw badRequest("Invitation has expired.");
              }
              // Accept before create so a revoke that wins under the invitation
              // lock fails the join and rolls back guest membership.
              const accepted = await tx.chatRoomGuestInvitation.updateMany({
                where: {
                  id: row.id,
                  status: CHAT_ROOM_INVITATION_STATUS.PENDING,
                  expiresAt: { gt: now },
                },
                data: {
                  status: CHAT_ROOM_INVITATION_STATUS.ACCEPTED,
                  acceptedAt: now,
                  acceptedByUserId: userContext.userId,
                },
              });
              if (accepted.count === 0) {
                throw badRequest("Invitation is no longer pending.");
              }
              return "continue";
            },
          });

        const invitationStatus = await resolveInvitationStatusAfterJoin(tx, {
          invitationId: row.id,
          userId: userContext.userId,
          rowStatus: row.status,
          expiresAt: row.expiresAt,
          now,
          outcome: result.outcome,
        });

        return {
          invitation: mapChatRoomInvitationFromRecord(
            row,
            {
              id: room.id,
              name: result.roomName,
              organizationId: room.organizationId,
              organizationName: room.organization?.name,
            },
            { status: invitationStatus },
          ),
          statusMessages: joinStatusMessages,
        };
      },
    );

    for (const message of statusMessages) {
      await publishChatRoomMessageRealtime(message, "create");
    }

    return ok(c, invitation);
  });
}
