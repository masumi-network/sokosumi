import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { publishChatMembershipRevokedToUsers } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminArchivedMatchedChannelSchema,
  adminMatchedChannelRoomParamsSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "post",
  path: "/{roomId}/archive",
  operationId: "archiveAdminMatchedChannel",
  description:
    "Soft-archive a live org-less matched channel (admin only). Sets archivedAt so the room leaves the live hub list and becomes unreachable for remaining members. Memberships are kept; messages stay. Does not require an organization.",
  tags: ["Admin"],
  request: {
    params: adminMatchedChannelRoomParamsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminArchivedMatchedChannelSchema,
      "Matched channel archived",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { roomId } = c.req.valid("param");

    const archived = await prisma.$transaction(async (tx) => {
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
        room.archivedAt !== null
      ) {
        throw notFound("Room not found");
      }

      const archivedAt = new Date();
      const updated = await tx.chatRoom.updateMany({
        where: { id: room.id, archivedAt: null },
        data: { archivedAt },
      });
      if (updated.count === 0) {
        throw notFound("Room not found");
      }

      const memberIds = (
        await tx.chatRoomUserMember.findMany({
          where: { roomId: room.id },
          select: { userId: true },
        })
      ).map((member) => member.userId);

      return { id: room.id, archivedAt, memberIds };
    });

    if (archived.memberIds.length > 0) {
      try {
        await publishChatMembershipRevokedToUsers(
          archived.id,
          archived.memberIds,
          "removed",
        );
      } catch (error) {
        console.error(
          "Failed to publish chat membership revoke after matched archive",
          error,
        );
      }
    }

    return ok(
      c,
      adminArchivedMatchedChannelSchema.parse({
        id: archived.id,
        archivedAt: archived.archivedAt,
      }),
    );
  });
}
