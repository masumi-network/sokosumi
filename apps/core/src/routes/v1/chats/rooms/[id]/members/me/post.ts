import { createRoute, z } from "@hono/zod-openapi";

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
  mapChatRoom,
  requireActiveOrganizationId,
  requireJoinablePublicOrgChannel,
} from "../../../helpers";

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
      "Self-join an active public channel in the active organization. Idempotent when already a member. Private, unknown, wrong-org, direct, or archived rooms return 404 (or 400 when the locked row is no longer joinable).",
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
  visibility: string | null;
  archivedAt: Date | null;
  organizationId: string | null;
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const organizationId = requireActiveOrganizationId(userContext);
    const { id } = c.req.valid("param");

    const room = await prisma.$transaction(async (tx) => {
      const existing = await requireJoinablePublicOrgChannel(
        id,
        userContext.userId,
        organizationId,
        tx,
      );

      const lockedRooms = await tx.$queryRaw<LockedJoinableRoom[]>`
        SELECT "id", "kind", "visibility", "archivedAt", "organizationId"
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
        locked.visibility !== "public" ||
        locked.organizationId !== organizationId
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
        select: { id: true },
      });

      if (!alreadyMember) {
        await tx.chatRoomUserMember.create({
          data: {
            roomId: existing.id,
            userId: userContext.userId,
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
      }

      return tx.chatRoom.findFirstOrThrow({
        where: { id: existing.id },
        include: chatRoomInclude,
      });
    });

    return ok(c, chatRoomSchema.parse(mapChatRoom(room, userContext.userId)));
  });
}
