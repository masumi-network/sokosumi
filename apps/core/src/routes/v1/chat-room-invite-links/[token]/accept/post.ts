import { createRoute, z } from "@hono/zod-openapi";
import { chatRoomGuestInviteLinkRepository } from "@sokosumi/database/repositories";
import { evaluateInviteLinkStatus } from "@sokosumi/utils";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { CHAT_ROOM_ACCESS } from "@/schemas/chat-room.schema";
import { acceptChatRoomGuestInviteLinkResponseSchema } from "@/schemas/chat-room-guest-invite-link.schema";

import { recordChannelMembershipStatus } from "../../../chats/rooms/membership-status";

const params = z.object({
  token: z
    .string()
    .min(1)
    .openapi({
      param: { name: "token", in: "path" },
      description: "Invite link capability token from the /chat/join URL",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{token}/accept",
    description:
      "Join an external channel as a guest via a shareable invite link. Creates `ChatRoomUserMember` with `access=guest` (no org Member / seat). Rejects host-org members (they self-join as members). Idempotent when already a guest. Rejects expired / revoked / depleted links.",
    tags: ["Chat Room Invite Links"],
    request: { params },
    responses: {
      200: jsonSuccessResponse(
        acceptChatRoomGuestInviteLinkResponseSchema,
        "Joined, or already a guest",
      ),
      400: jsonErrorResponse(
        "Bad Request - link expired, revoked, or depleted",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse(
        "Forbidden - session user required (coworker rejected)",
      ),
      404: jsonErrorResponse("Not Found - invalid link or room"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Session-only: a coworker key must not enroll an arbitrary user.
    const userContext = requireUserAuthContext(c.var.authContext);
    const { token } = c.req.valid("param");
    const now = new Date();

    const link = await chatRoomGuestInviteLinkRepository.getInviteLinkByToken(
      token,
      prisma,
    );
    const status = evaluateInviteLinkStatus(link, now);
    if (!link || status === "not_found") {
      throw notFound("This invite link is not valid.");
    }
    if (status !== "valid") {
      throw badRequest(
        status === "expired"
          ? "This invite link has expired."
          : status === "revoked"
            ? "This invite link has been revoked."
            : "This invite link has reached its usage limit.",
      );
    }

    const { outcome, roomId, roomName, statusMessages } =
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userContext.userId },
          select: { name: true },
        });
        if (!user) {
          throw notFound("User not found");
        }

        // Lock room before guest membership so convert-off-external cannot race
        // past the discoverability check and leave guests on non-external rooms.
        await tx.$queryRaw`
        SELECT "id" FROM "chat_room"
        WHERE "id" = ${link.roomId}::uuid
        FOR UPDATE
      `;

        const room = await tx.chatRoom.findUnique({
          where: { id: link.roomId },
          select: {
            id: true,
            name: true,
            kind: true,
            discoverability: true,
            archivedAt: true,
            organizationId: true,
          },
        });
        if (
          !room ||
          room.archivedAt !== null ||
          room.kind !== "channel" ||
          room.discoverability !== "external" ||
          !room.organizationId
        ) {
          throw badRequest(
            "Room is no longer available for guest invitations.",
          );
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

        // Idempotent: already guest — do not consume a use.
        if (existingMembership?.access === CHAT_ROOM_ACCESS.GUEST) {
          return {
            outcome: "already_guest" as const,
            roomId: room.id,
            roomName: room.name,
            statusMessages: [] as Awaited<
              ReturnType<typeof recordChannelMembershipStatus>
            >,
          };
        }

        if (existingMembership) {
          throw badRequest("Already a member of this room.");
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

        const consumed =
          await chatRoomGuestInviteLinkRepository.tryConsumeInviteLink(
            { id: link.id, now, maxUses: link.maxUses },
            tx,
          );
        if (!consumed) {
          return {
            outcome: "depleted" as const,
            roomId: room.id,
            roomName: room.name,
            statusMessages: [] as Awaited<
              ReturnType<typeof recordChannelMembershipStatus>
            >,
          };
        }

        try {
          await tx.chatRoomUserMember.create({
            data: {
              roomId: room.id,
              userId: userContext.userId,
              access: CHAT_ROOM_ACCESS.GUEST,
            },
          });
        } catch (error) {
          if (!isPrismaUniqueViolation(error)) {
            throw error;
          }
          const raced = await tx.chatRoomUserMember.findUnique({
            where: {
              roomId_userId: {
                roomId: room.id,
                userId: userContext.userId,
              },
            },
            select: { access: true },
          });
          if (raced?.access === CHAT_ROOM_ACCESS.GUEST) {
            // Concurrent double-accept as guest: treat as already_guest.
            // Consume already happened; acceptable under race (one use spent).
            return {
              outcome: "already_guest" as const,
              roomId: room.id,
              roomName: room.name,
              statusMessages: [] as Awaited<
                ReturnType<typeof recordChannelMembershipStatus>
              >,
            };
          }
          throw badRequest("Already a member of this room.");
        }

        await tx.chatRoomReadState.createMany({
          data: [{ roomId: room.id, userId: userContext.userId }],
          skipDuplicates: true,
        });

        const actorName = user.name?.trim() || "Someone";
        const messages = await recordChannelMembershipStatus(tx, {
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
          outcome: "joined" as const,
          roomId: room.id,
          roomName: room.name,
          statusMessages: messages,
        };
      });

    if (outcome === "depleted") {
      throw badRequest("This invite link has reached its usage limit.");
    }

    for (const message of statusMessages) {
      await publishChatRoomMessageRealtime(message, "create");
    }

    return ok(
      c,
      acceptChatRoomGuestInviteLinkResponseSchema.parse({
        status: outcome === "joined" ? "joined" : "already_guest",
        roomId,
        roomName,
      }),
    );
  });
}
