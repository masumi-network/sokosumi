import { createRoute, z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  addChatRoomMembersRequestSchema,
  chatRoomSchema,
} from "@/schemas/chat-room.schema";

import {
  publishChannelMembershipEffects,
  requireChannelRosterAccess,
} from "../../channel-membership";
import {
  chatRoomInclude,
  filterOrganizationUserIds,
  mapChatRoomWithSidebarFlags,
  normalizeUniqueStrings,
  resolveWorkspaceIdForChatRoom,
  validateChatCoworkerIds,
  validateChatSokoBotIds,
} from "../../helpers";
import {
  type ChannelMembershipChange,
  recordChannelMembershipStatus,
} from "../../membership-status";

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
    method: "post",
    path: "/{id}/members",
    description:
      "Add organization members, Coworkers and the caller's own Soko Bots to a Channel. Any host member (`access=member`) may add; Guests may not. Only a Soko Bot's owner may add it. Members already in the Channel are left as they are. Matched channels are managed by Sokosumi.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": { schema: addChatRoomMembersRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Members added"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonErrorResponse("Concurrent membership change"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const { room, statusMessages } = await serializableTransaction(
      async (tx) => {
        const requestedUserIds = normalizeUniqueStrings(body.userIds ?? []);
        const {
          room: existing,
          organizationId,
          actor,
        } = await requireChannelRosterAccess(
          tx,
          id,
          userContext.userId,
          requestedUserIds,
        );
        const changes: ChannelMembershipChange[] = [];
        if (requestedUserIds.length > 0) {
          const orgUserIds = await filterOrganizationUserIds(
            organizationId,
            requestedUserIds,
            tx,
          );
          if (orgUserIds.length !== requestedUserIds.length) {
            throw badRequest(
              "Room human members must belong to the organization",
            );
          }
          const hostIds = new Set(
            existing.userMembers
              .filter((member) => member.access === "member")
              .map((member) => member.userId),
          );
          const addedUserIds = orgUserIds.filter(
            (userId) => !hostIds.has(userId),
          );
          if (addedUserIds.length > 0) {
            // A Guest who has since joined the organization becomes a host
            // member in place (one row per room and user).
            await tx.chatRoomUserMember.updateMany({
              where: {
                roomId: existing.id,
                userId: { in: addedUserIds },
                access: "guest",
              },
              data: { access: "member" },
            });
            await tx.chatRoomUserMember.createMany({
              data: addedUserIds.map((userId) => ({
                roomId: existing.id,
                userId,
                access: "member",
              })),
              skipDuplicates: true,
            });
            await tx.chatRoomReadState.createMany({
              data: addedUserIds.map((userId) => ({
                roomId: existing.id,
                userId,
              })),
              skipDuplicates: true,
            });
            const guestIds = new Set(
              existing.userMembers
                .filter((member) => member.access === "guest")
                .map((member) => member.userId),
            );
            const users = await tx.user.findMany({
              where: {
                id: {
                  in: addedUserIds.filter((userId) => !guestIds.has(userId)),
                },
              },
              select: { id: true, name: true },
            });
            for (const user of users) {
              changes.push({
                action: "joined",
                subject: { type: "user", id: user.id, name: user.name },
                actor,
              });
            }
          }
        }

        const presentCoworkerIds = new Set(
          existing.coworkerMembers.map((member) => member.coworker.id),
        );
        const requestedCoworkerIds = normalizeUniqueStrings(
          body.coworkerIds ?? [],
        ).filter((coworkerId) => !presentCoworkerIds.has(coworkerId));
        const presentSokoBotIds = existing.sokoBotMembers.map(
          (member) => member.sokoBot.id,
        );
        const requestedSokoBotIds = normalizeUniqueStrings(
          body.sokoBotIds ?? [],
        ).filter((sokoBotId) => !presentSokoBotIds.includes(sokoBotId));

        if (requestedCoworkerIds.length > 0 || requestedSokoBotIds.length > 0) {
          const workspaceId = await resolveWorkspaceIdForChatRoom({
            organizationId,
            personalUserId: userContext.userId,
            tx,
          });

          if (requestedCoworkerIds.length > 0) {
            await validateChatCoworkerIds(
              requestedCoworkerIds,
              workspaceId,
              tx,
            );
            await tx.chatRoomCoworkerMember.createMany({
              data: requestedCoworkerIds.map((coworkerId) => ({
                roomId: existing.id,
                coworkerId,
              })),
              skipDuplicates: true,
            });
            const coworkers = await tx.coworker.findMany({
              where: { id: { in: requestedCoworkerIds } },
              select: { id: true, name: true },
            });
            for (const coworker of coworkers) {
              changes.push({
                action: "joined",
                subject: {
                  type: "coworker",
                  id: coworker.id,
                  name: coworker.name,
                },
                actor,
              });
            }
          }

          if (requestedSokoBotIds.length > 0) {
            // Owner-only: nobody adds someone else's Soko Bot.
            await validateChatSokoBotIds(
              requestedSokoBotIds,
              workspaceId,
              userContext.userId,
              [],
              tx,
            );
            await tx.chatRoomSokoBotMember.createMany({
              data: requestedSokoBotIds.map((sokoBotId) => ({
                roomId: existing.id,
                sokoBotId,
              })),
              skipDuplicates: true,
            });
            const bots = await tx.sokoBot.findMany({
              where: { id: { in: requestedSokoBotIds } },
              select: { id: true, name: true },
            });
            for (const bot of bots) {
              changes.push({
                action: "joined",
                subject: {
                  type: "sokoBot",
                  id: bot.id,
                  name: sokoBotDisplayName(bot),
                },
                actor,
              });
            }
          }
        }

        const statusMessages = await recordChannelMembershipStatus(tx, {
          roomId: existing.id,
          roomKind: existing.kind,
          changes,
        });
        return {
          room: await tx.chatRoom.findUniqueOrThrow({
            where: { id: existing.id },
            include: chatRoomInclude,
          }),
          statusMessages,
        };
      },
      "Channel membership changed concurrently. Please try again.",
    );

    await publishChannelMembershipEffects({ roomId: room.id, statusMessages });

    return ok(
      c,
      chatRoomSchema.parse(
        await mapChatRoomWithSidebarFlags(room, userContext.userId, prisma),
      ),
    );
  });
}
