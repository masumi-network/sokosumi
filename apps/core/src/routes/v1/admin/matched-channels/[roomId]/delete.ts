import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import { publishChatMembershipRevokedToUsers } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminMatchedChannelRoomParamsSchema } from "@/schemas/admin.schema";

const route = createRoute({
  method: "delete",
  path: "/{roomId}",
  operationId: "deleteAdminMatchedChannel",
  description:
    "Permanently delete a soft-archived org-less matched channel (admin only). Removes the room row and cascaded memberships, messages, and related chat state. The channel must already be archived. Live channels must be archived first.",
  tags: ["Admin"],
  request: {
    params: adminMatchedChannelRoomParamsSchema,
  },
  responses: {
    204: {
      description: "Matched channel permanently deleted",
    },
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { roomId } = c.req.valid("param");

    const deleted = await prisma.$transaction(async (tx) => {
      const lockedRooms = await tx.$queryRaw<
        Array<{
          id: string;
          organizationId: string | null;
          kind: string;
          discoverability: string | null;
          archivedAt: Date | null;
        }>
      >`
        SELECT "id", "organizationId", "kind", "discoverability", "archivedAt"
        FROM "chat_room"
        WHERE "id" = ${roomId}::uuid
        FOR UPDATE
      `;
      const room = lockedRooms[0];
      if (
        !room ||
        room.organizationId !== null ||
        room.kind !== "channel" ||
        room.discoverability !== "matched" ||
        room.archivedAt === null
      ) {
        throw notFound("Room not found");
      }

      const memberIds = (
        await tx.chatRoomUserMember.findMany({
          where: { roomId: room.id },
          select: { userId: true },
        })
      ).map((member) => member.userId);

      const removed = await tx.chatRoom.deleteMany({
        where: { id: room.id, archivedAt: { not: null } },
      });
      if (removed.count === 0) {
        throw notFound("Room not found");
      }

      return { id: room.id, memberIds };
    });

    if (deleted.memberIds.length > 0) {
      try {
        await publishChatMembershipRevokedToUsers(
          deleted.id,
          deleted.memberIds,
          "removed",
        );
      } catch (error) {
        console.error(
          "Failed to publish chat membership revoke after matched delete",
          error,
        );
      }
    }

    return empty(c);
  });
}
