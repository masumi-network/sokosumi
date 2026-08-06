import { createRoute, z } from "@hono/zod-openapi";

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
import { chatRoomSchema } from "@/schemas/chat-room.schema";

import {
  chatRoomInclude,
  isJoinableChannelDiscoverability,
  mapChatRoom,
  requireActiveOrganizationId,
  requireJoinableOrgChannel,
} from "../../../helpers";
import { recordChannelMembershipStatus } from "../../../membership-status";

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
    path: "/{id}/members/me",
    description:
      "Self-join an active channel in the active organization. Public and external channels are joinable by any org member; private channels by organization owners and admins only. Idempotent when already a member. If the caller is already a guest and is now a host-org member, upgrades access to member. Unknown, wrong-org, direct, archived, or private-for-plain-member rooms return 404 (or 400 when the locked row is no longer joinable). External-channel guests join via room invitation, not this endpoint.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Joined the room"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

interface LockedJoinableRoom {
  id: string;
  kind: string;
  discoverability: string | null;
  archivedAt: Date | null;
  organizationId: string | null;
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const organizationId = requireActiveOrganizationId(userContext);
    const { id } = c.req.valid("param");

    const { room, statusMessages } = await prisma.$transaction(async (tx) => {
      const { room: existing, elevated } = await requireJoinableOrgChannel(
        id,
        userContext.userId,
        organizationId,
        tx,
      );

      const lockedRooms = await tx.$queryRaw<LockedJoinableRoom[]>`
        SELECT "id", "kind", "discoverability", "archivedAt", "organizationId"
        FROM "chat_room"
        WHERE "id" = ${existing.id}::uuid
        FOR UPDATE
      `;
      if (lockedRooms.length === 0) {
        throw badRequest("Room could not be joined.");
      }

      const locked = lockedRooms[0];
      if (
        !locked ||
        locked.archivedAt !== null ||
        locked.kind !== "channel" ||
        locked.organizationId !== organizationId ||
        !isJoinableChannelDiscoverability(locked.discoverability, elevated)
      ) {
        throw notFound("Room not found");
      }

      const alreadyMember = await tx.chatRoomUserMember.findUnique({
        where: {
          roomId_userId: {
            roomId: existing.id,
            userId: userContext.userId,
          },
        },
        select: { id: true, access: true },
      });

      let createdStatus = [] as Awaited<
        ReturnType<typeof recordChannelMembershipStatus>
      >;

      if (alreadyMember?.access === "guest") {
        // Guest later joined the host org and is self-joining as a real member.
        // Upgrade in place; no second join status (they were already in the room).
        await tx.chatRoomUserMember.update({
          where: {
            roomId_userId: {
              roomId: existing.id,
              userId: userContext.userId,
            },
          },
          data: { access: "member" },
        });
      } else if (!alreadyMember) {
        await tx.chatRoomUserMember.create({
          data: {
            roomId: existing.id,
            userId: userContext.userId,
            access: "member",
          },
        });
        await tx.chatRoomReadState.createMany({
          data: [
            {
              roomId: existing.id,
              userId: userContext.userId,
            },
          ],
          skipDuplicates: true,
        });

        const actor = await tx.user.findUnique({
          where: { id: userContext.userId },
          select: { name: true },
        });
        const actorName = actor?.name?.trim() || "Someone";

        createdStatus = await recordChannelMembershipStatus(tx, {
          roomId: existing.id,
          roomKind: locked.kind,
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
      }

      const room = await tx.chatRoom.findFirstOrThrow({
        where: { id: existing.id },
        include: chatRoomInclude,
      });

      return { room, statusMessages: createdStatus };
    });

    for (const message of statusMessages) {
      await publishChatRoomMessageRealtime(message, "create");
    }

    return ok(c, chatRoomSchema.parse(mapChatRoom(room, userContext.userId)));
  });
}
