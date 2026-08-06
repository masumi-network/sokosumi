import { createRoute, z } from "@hono/zod-openapi";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import { publishChatMembershipRevokedToUsers } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
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
  mapChatRoomWithSidebarFlags,
  requireChatRoomUserAccess,
  resolveWorkspaceIdForChatRoom,
  slugifyRoomName,
  validateChatCoworkerIds,
  validateOrganizationUserIds,
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
      409: jsonErrorResponse("Room already exists"),
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
      const { room, statusMessages, removedUserIds } =
        await prisma.$transaction(async (tx) => {
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

          // Membership proves the caller can read the room. Settings (name/topic/
          // discoverability) need OWNER/ADMIN; roster rewrite is open to any
          // active channel member. Assert before any writes.
          const { role } = await resolveMemberOrganizationById({
            id: organizationId,
            userId: userContext.userId,
            tx,
          });
          assertChatRoomPatchAuth({ role, body });

          const updateData: {
            name?: string;
            slug?: string;
            topic?: string | null;
            discoverability?: "public" | "private";
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

          const priorUsers =
            body.memberUserIds !== undefined
              ? existing.userMembers.map((member) => ({
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
            const memberUserIds = await validateOrganizationUserIds(
              organizationId,
              [userContext.userId, ...body.memberUserIds],
              tx,
            );
            const users = await tx.user.findMany({
              where: { id: { in: memberUserIds } },
              select: { id: true, name: true },
            });
            const nameById = new Map(users.map((user) => [user.id, user.name]));
            nextUsers = memberUserIds.map((userId) => ({
              id: userId,
              name: nameById.get(userId) ?? userId,
            }));

            await tx.chatRoomUserMember.deleteMany({
              where: { roomId: existing.id },
            });
            await tx.chatRoomReadState.deleteMany({
              where: {
                roomId: existing.id,
                userId: { notIn: memberUserIds },
              },
            });
            await tx.chatRoomUserMember.createMany({
              data: memberUserIds.map((memberUserId) => ({
                roomId: existing.id,
                userId: memberUserId,
              })),
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

          return { room, statusMessages: createdStatus, removedUserIds };
        });

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
