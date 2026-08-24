import { createRoute, z } from "@hono/zod-openapi";

import {
  expireStalePendingInvitations,
  livePendingInvitationWhere,
} from "@/helpers/chat-room-invitation";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, conflict, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import { publishChatMembershipRevokedToUsers } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatRoomSchema,
  updateChatRoomRequestSchema,
} from "@/schemas/chat-room.schema";

import {
  assertChatRoomPatchAuth,
  buildUniqueRoomSlug,
  chatRoomInclude,
  filterOrganizationUserIds,
  mapChatRoomWithSidebarFlags,
  membershipAccessForUser,
  normalizeUniqueStrings,
  requireChatRoomUserAccess,
  resolveWorkspaceIdForChatRoom,
  slugifyRoomName,
  validateChatCoworkerIds,
} from "../helpers";
import {
  diffChannelMembershipRoster,
  recordChannelMembershipStatus,
} from "../membership-status";

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
    method: "patch",
    path: "/{id}",
    description: "Update an organization chat room and its roster.",
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

    try {
      // Serializable so a concurrent leave cannot commit under a stale roster
      // snapshot that would re-create the leaver's membership (SSI → 409
      // concurrency_conflict). Leave still uses FOR UPDATE on the room row.
      const { room, statusMessages, removedUserIds } =
        await serializableTransaction(async (tx) => {
          const existing = await requireChatRoomUserAccess(
            id,
            userContext.userId,
            tx,
          );

          // A direct room's identity IS its participant set: `directKey` is
          // derived from it, and `POST /chats/rooms` with `kind: "direct"`
          // resolves an existing DM by that key alone. Renaming one or rewriting
          // its roster here would leave the key pointing at a membership that no
          // longer matches, so reopening the DM could hand someone a conversation
          // they are no longer part of. Direct rooms are created, never edited.
          if (existing.kind === "direct") {
            throw badRequest("Direct rooms cannot be edited.");
          }

          if (!existing.organizationId) {
            throw badRequest("Channel rooms require an organization.");
          }
          const organizationId = existing.organizationId;

          // Guests may read/write messages but cannot manage settings or roster.
          // Fail before host-org role resolution so the message is guest-specific.
          const callerAccess = membershipAccessForUser(
            existing.userMembers,
            userContext.userId,
          );
          if (callerAccess === "guest") {
            throw forbidden("Guests cannot update channel settings or roster.");
          }

          // Membership + host-org role: settings need OWNER/ADMIN; roster rewrite
          // is open to any access=member channel participant. Assert before writes.
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
            slug?: string;
            topic?: string | null;
            discoverability?: "public" | "private" | "external";
          } = {};

          if (body.name !== undefined) {
            updateData.name = body.name;
            const nextBaseSlug = slugifyRoomName(body.name);
            if (nextBaseSlug !== existing.slug) {
              updateData.slug = await buildUniqueRoomSlug(
                organizationId,
                body.name,
                existing.createdByUserId,
                tx,
              );
            }
          }

          if (body.topic !== undefined) {
            updateData.topic = body.topic?.trim() || null;
          }

          if (body.discoverability !== undefined) {
            updateData.discoverability = body.discoverability;
          }

          // Roster rewrites only cover host-org members. Guests are room-scoped
          // and must survive PATCH (web always sends memberUserIds on save).
          let priorUsers =
            body.memberUserIds !== undefined
              ? existing.userMembers
                  .filter((member) => member.access !== "guest")
                  .map((member) => ({
                    id: member.user.id,
                    name: member.user.name,
                  }))
              : [];
          const priorCoworkers =
            body.coworkerIds !== undefined
              ? existing.coworkerMembers.map((member) => ({
                  id: member.coworker.id,
                  name: member.coworker.name,
                }))
              : [];

          let nextUsers = priorUsers;
          let nextCoworkers = priorCoworkers;

          if (body.memberUserIds !== undefined) {
            // Host roster only. Guest ids echoed in memberUserIds are ignored
            // (they are not org members); they must not 400 the rewrite.
            const requestedUserIds = normalizeUniqueStrings([
              userContext.userId,
              ...body.memberUserIds,
            ]);
            const foundHostIds = await filterOrganizationUserIds(
              organizationId,
              requestedUserIds,
              tx,
            );
            const guestIdsOnRoom = new Set(
              existing.userMembers
                .filter((member) => member.access === "guest")
                .map((member) => member.userId),
            );
            const unexpected = requestedUserIds.filter(
              (userId) =>
                !foundHostIds.includes(userId) && !guestIdsOnRoom.has(userId),
            );
            if (unexpected.length > 0) {
              throw badRequest(
                "Room human members must belong to the organization",
              );
            }
            const memberUserIds = foundHostIds;
            const users = await tx.user.findMany({
              where: { id: { in: memberUserIds } },
              select: { id: true, name: true },
            });
            const nameById = new Map(users.map((user) => [user.id, user.name]));
            nextUsers = memberUserIds.map((userId) => ({
              id: userId,
              name: nameById.get(userId) ?? userId,
            }));

            // Guests already in the room who appear on the host roster (e.g. they
            // later joined the host org) count as already present for status diffs.
            const memberIdSet = new Set(memberUserIds);
            priorUsers = existing.userMembers
              .filter(
                (member) =>
                  member.access !== "guest" || memberIdSet.has(member.user.id),
              )
              .map((member) => ({
                id: member.user.id,
                name: member.user.name,
              }));

            const preservedGuestIds = existing.userMembers
              .filter(
                (member) =>
                  member.access === "guest" && !memberIdSet.has(member.userId),
              )
              .map((member) => member.userId);

            // Rewrite only host members; never delete access=guest rows omitted
            // from memberUserIds (silent guest eviction).
            await tx.chatRoomUserMember.deleteMany({
              where: { roomId: existing.id, access: "member" },
            });
            // Guest who is now on the host roster → upgrade in place (unique roomId+userId).
            await tx.chatRoomUserMember.updateMany({
              where: {
                roomId: existing.id,
                userId: { in: memberUserIds },
                access: "guest",
              },
              data: { access: "member" },
            });
            const remainingAfterDelete = await tx.chatRoomUserMember.findMany({
              where: { roomId: existing.id },
              select: { userId: true },
            });
            const remainingIds = new Set(
              remainingAfterDelete.map((row) => row.userId),
            );
            const membersToCreate = memberUserIds.filter(
              (userId) => !remainingIds.has(userId),
            );
            if (membersToCreate.length > 0) {
              await tx.chatRoomUserMember.createMany({
                data: membersToCreate.map((memberUserId) => ({
                  roomId: existing.id,
                  userId: memberUserId,
                  access: "member",
                })),
              });
            }

            const keepUserIds = [...memberUserIds, ...preservedGuestIds];
            await tx.chatRoomReadState.deleteMany({
              where: {
                roomId: existing.id,
                userId: { notIn: keepUserIds },
              },
            });
            await tx.chatRoomReadState.createMany({
              data: memberUserIds.map((memberUserId) => ({
                roomId: existing.id,
                userId: memberUserId,
              })),
              skipDuplicates: true,
            });
          }

          if (body.coworkerIds !== undefined) {
            const workspaceId = await resolveWorkspaceIdForChatRoom({
              organizationId,
              personalUserId: userContext.userId,
              tx,
            });
            const coworkerIds = await validateChatCoworkerIds(
              body.coworkerIds,
              workspaceId,
              tx,
            );
            const coworkers = await tx.coworker.findMany({
              where: { id: { in: coworkerIds } },
              select: { id: true, name: true },
            });
            const nameById = new Map(
              coworkers.map((coworker) => [coworker.id, coworker.name]),
            );
            nextCoworkers = coworkerIds.map((coworkerId) => ({
              id: coworkerId,
              name: nameById.get(coworkerId) ?? coworkerId,
            }));

            // Fail open mentions for coworkers dropped from the roster so a
            // queued dispatch cannot post after eviction.
            await tx.chatRoomMention.updateMany({
              where: {
                status: { in: ["pending", "sent"] },
                coworkerId: { notIn: coworkerIds },
                message: { roomId: existing.id },
              },
              data: {
                status: "failed",
                error: "Coworker is no longer a member of this room",
              },
            });
            await tx.chatRoomCoworkerMember.deleteMany({
              where: { roomId: existing.id },
            });
            if (coworkerIds.length > 0) {
              await tx.chatRoomCoworkerMember.createMany({
                data: coworkerIds.map((coworkerId) => ({
                  roomId: existing.id,
                  coworkerId,
                })),
              });
            }
          }

          const changes = diffChannelMembershipRoster({
            prior: { users: priorUsers, coworkers: priorCoworkers },
            next: { users: nextUsers, coworkers: nextCoworkers },
          });
          const createdStatus = await recordChannelMembershipStatus(tx, {
            roomId: existing.id,
            roomKind: existing.kind,
            changes,
          });

          const room = await tx.chatRoom.update({
            where: { id: existing.id },
            data: updateData,
            include: chatRoomInclude,
          });

          const removedUserIds = changes
            .filter(
              (change) =>
                change.action === "left" && change.subject.type === "user",
            )
            .map((change) => change.subject.id);

          return {
            room,
            statusMessages: createdStatus,
            removedUserIds,
          };
        }, "Chat room was modified concurrently; please retry.");

      // Status timeline and revoke are independent: membership is already
      // committed; a failed status publish must not skip cap revoke.
      const [statusResults, revokeResult] = await Promise.allSettled([
        Promise.all(
          statusMessages.map((message) =>
            publishChatRoomMessageRealtime(message, "create"),
          ),
        ),
        publishChatMembershipRevokedToUsers(room.id, removedUserIds, "removed"),
      ]);
      if (statusResults.status === "rejected") {
        console.error(
          "Failed to publish chat membership status messages after roster patch",
          statusResults.reason,
        );
      }
      if (revokeResult.status === "rejected") {
        console.error(
          "Failed to publish chat membership revoke after roster patch",
          revokeResult.reason,
        );
      }

      return ok(
        c,
        chatRoomSchema.parse(
          await mapChatRoomWithSidebarFlags(room, userContext.userId, prisma),
        ),
      );
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        throw conflict("Room already exists");
      }
      throw error;
    }
  });
}
