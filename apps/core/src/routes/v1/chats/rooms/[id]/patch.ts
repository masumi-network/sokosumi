import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import {
  expireStalePendingInvitations,
  livePendingInvitationWhere,
} from "@/helpers/chat-room-invitation";
import { publishChatRoomMembershipStatusMessagesBestEffort } from "@/helpers/chat-room-message-realtime";
import { badRequest, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatRoomSchema,
  updateChatRoomRequestSchema,
} from "@/schemas/chat-room.schema";

import {
  assertChatRoomPatchAuth,
  type ChatRoomWithMembers,
  chatRoomInclude,
  isGroupDirectRoom,
  mapChatRoomWithSidebarFlags,
  membershipAccessForUser,
  requireChatRoomUserAccess,
} from "../helpers";
import { recordGroupNameChange } from "../membership-status";

const ONLY_GROUP_DIRECTS_CAN_BE_NAMED = "Only group Directs can be named.";

type UpdateChatRoomRequest = z.infer<typeof updateChatRoomRequestSchema>;

/**
 * The one edit a Direct takes. A direct room's identity IS its participant
 * set: `directKey` is derived from it, and `POST /chats/rooms` with
 * `kind: "direct"` resolves an existing DM by that key alone. Rewriting its
 * roster would leave the key pointing at a membership that no longer matches,
 * so every other field stays rejected. A Group name only labels the room and
 * leaves the key and roster alone (ADR-0040), so any member of a group Direct
 * may set, change or clear it. Saving what is already there changes nothing.
 */
async function updateGroupName(
  tx: Prisma.TransactionClient,
  existing: ChatRoomWithMembers,
  body: UpdateChatRoomRequest,
  userId: string,
) {
  const { groupName, ...otherFields } = body;
  if (
    groupName === undefined ||
    Object.values(otherFields).some((value) => value !== undefined)
  ) {
    throw badRequest("Direct rooms cannot be edited.");
  }
  if (!isGroupDirectRoom(existing)) {
    throw badRequest(ONLY_GROUP_DIRECTS_CAN_BE_NAMED);
  }

  const next = groupName || null;
  const unchanged = {
    room: existing,
    statusMessages: [],
  };
  if (next === existing.groupName) {
    return unchanged;
  }

  await tx.chatRoom.update({
    where: { id: existing.id },
    data: { groupName: next },
  });
  const actor = existing.userMembers.find((member) => member.userId === userId);
  const statusMessage = await recordGroupNameChange(tx, {
    roomId: existing.id,
    change: {
      action: next ? "named" : "cleared",
      name: next,
      actor: { id: userId, name: actor?.user.name ?? "" },
    },
  });
  return {
    ...unchanged,
    // Re-read after the status row, whose `updatedAt` bump is the last write.
    room: await tx.chatRoom.findUniqueOrThrow({
      where: { id: existing.id },
      include: chatRoomInclude,
    }),
    statusMessages: [statusMessage],
  };
}

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/{id}",
    description:
      "Update a Channel's name, topic or discoverability (organization owner/admin), or a group Direct's `groupName`. Members are added and removed through `/members`, `/coworkers` and `/soko-bots`.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: updateChatRoomRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Chat room updated"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      409: jsonErrorResponse("Conflict"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    if (body.slug !== undefined) {
      throw badRequest("Channel slug cannot be changed");
    }

    // Serializable so a concurrent edit of the same room fails as a retryable
    // 409 concurrency_conflict instead of one change silently overwriting the
    // other.
    const { room, statusMessages } = await serializableTransaction(
      async (tx) => {
        const existing = await requireChatRoomUserAccess(
          id,
          userContext.userId,
          tx,
        );

        if (existing.kind === "direct") {
          return await updateGroupName(tx, existing, body, userContext.userId);
        }

        if (body.groupName !== undefined) {
          throw badRequest(ONLY_GROUP_DIRECTS_CAN_BE_NAMED);
        }

        if (!existing.organizationId) {
          throw badRequest("Channel rooms require an organization.");
        }
        const organizationId = existing.organizationId;

        // Guests may read/write messages but cannot manage settings.
        // Fail before host-org role resolution so the message is guest-specific.
        const callerAccess = membershipAccessForUser(
          existing.userMembers,
          userContext.userId,
        );
        if (callerAccess === "guest") {
          throw forbidden("Guests cannot update channel settings.");
        }

        // Settings need OWNER/ADMIN. Assert before writes.
        const { role } = await resolveMemberOrganizationById({
          id: organizationId,
          userId: userContext.userId,
          tx,
        });
        assertChatRoomPatchAuth({ role, body });

        // external → public/private only when no guests remain and no live
        // pending invitations (convert would orphan invite lifecycle).
        if (
          body.discoverability !== undefined &&
          existing.discoverability === "external" &&
          body.discoverability !== "external"
        ) {
          // Serialize against concurrent accept so we cannot flip off external
          // while a guest membership lands under the same window.
          await tx.$queryRaw`
              SELECT "id" FROM "chat_room"
              WHERE "id" = ${existing.id}::uuid
              FOR UPDATE
            `;
          const now = new Date();
          await expireStalePendingInvitations(tx, {
            roomId: existing.id,
            now,
          });
          const guestCount = await tx.chatRoomUserMember.count({
            where: {
              roomId: existing.id,
              access: "guest",
            },
          });
          if (guestCount > 0) {
            throw badRequest(
              "Cannot change discoverability while guest members or pending invitations exist.",
            );
          }
          const pendingInviteCount = await tx.chatRoomGuestInvitation.count({
            where: livePendingInvitationWhere(existing.id, now),
          });
          if (pendingInviteCount > 0) {
            throw badRequest(
              "Cannot change discoverability while guest members or pending invitations exist.",
            );
          }
          const liveLinkCount = await tx.chatRoomGuestInviteLink.count({
            where: {
              roomId: existing.id,
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          });
          if (liveLinkCount > 0) {
            throw badRequest(
              "Cannot change discoverability while shareable invite links exist. Revoke or wait for them to expire first.",
            );
          }
        }

        const updateData: {
          name?: string;
          topic?: string | null;
          discoverability?: "public" | "private" | "external";
        } = {};

        if (body.name !== undefined) {
          updateData.name = body.name;
        }

        if (body.topic !== undefined) {
          updateData.topic = body.topic?.trim() || null;
        }

        if (body.discoverability !== undefined) {
          updateData.discoverability = body.discoverability;
        }

        const room = await tx.chatRoom.update({
          where: { id: existing.id },
          data: updateData,
          include: chatRoomInclude,
        });

        return { room, statusMessages: [] };
      },
      "Chat room was modified concurrently; please retry.",
    );

    // Only a group Direct's rename leaves a status row.
    if (statusMessages.length > 0) {
      await publishChatRoomMembershipStatusMessagesBestEffort(statusMessages);
    }

    return ok(
      c,
      chatRoomSchema.parse(
        await mapChatRoomWithSidebarFlags(room, userContext.userId, prisma),
      ),
    );
  });
}
