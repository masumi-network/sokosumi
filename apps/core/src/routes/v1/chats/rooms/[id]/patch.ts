import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import { badRequest, conflict, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
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
  buildUniqueRoomSlug,
  chatRoomInclude,
  mapChatRoom,
  requireChatRoomUserAccess,
  slugifyRoomName,
  validateChatCoworkerIds,
  validateOrganizationUserIds,
} from "../helpers";

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
      const room = await prisma.$transaction(async (tx) => {
        const existing = await requireChatRoomUserAccess(
          id,
          userContext.userId,
          tx,
        );

        // A direct room's identity IS its participant set: `directKey` is
        // derived from it, and `direct/post.ts` resolves an existing DM by that
        // key alone. Renaming one or rewriting its roster here would leave the
        // key pointing at a membership that no longer matches, so reopening the
        // DM could hand someone a conversation they are no longer part of.
        // Direct rooms are created, never edited.
        if (existing.kind === "direct") {
          throw badRequest("Direct rooms cannot be edited.");
        }

        // Membership alone only proves the caller can read the room. Editing
        // rewrites the whole roster, so a plain member could otherwise evict
        // everyone else from a room they merely belong to.
        const { role } = await resolveMemberOrganizationById({
          id: existing.organizationId,
          userId: userContext.userId,
          tx,
        });
        const canManageRoom =
          existing.createdByUserId === userContext.userId ||
          role === MemberRole.OWNER ||
          role === MemberRole.ADMIN;

        if (!canManageRoom) {
          throw forbidden(
            "Only the room creator or an organization owner or admin can update this room.",
          );
        }

        const updateData: {
          name?: string;
          slug?: string;
          topic?: string | null;
        } = {};

        if (body.name !== undefined) {
          updateData.name = body.name;
          const nextBaseSlug = slugifyRoomName(body.name);
          if (nextBaseSlug !== existing.slug) {
            updateData.slug = await buildUniqueRoomSlug(
              existing.organizationId,
              body.name,
              tx,
            );
          }
        }

        if (body.topic !== undefined) {
          updateData.topic = body.topic?.trim() || null;
        }

        if (body.memberUserIds !== undefined) {
          const memberUserIds = await validateOrganizationUserIds(
            existing.organizationId,
            [userContext.userId, ...body.memberUserIds],
            tx,
          );
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
          const coworkerIds = await validateChatCoworkerIds(
            body.coworkerIds,
            tx,
          );
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

        return tx.chatRoom.update({
          where: { id: existing.id },
          data: updateData,
          include: chatRoomInclude,
        });
      });

      return ok(c, chatRoomSchema.parse(mapChatRoom(room, userContext.userId)));
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        throw conflict("Room already exists");
      }
      throw error;
    }
  });
}
