import { createRoute, z } from "@hono/zod-openapi";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { publishChatMembershipRevoked } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { leftChatRoomSchema } from "@/schemas/chat-room.schema";

import { requireChatRoomUserAccess } from "../../../helpers";
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
    method: "delete",
    path: "/{id}/members/me",
    description:
      "Leave an organization chat room. Removes only the caller's membership and read marker; the room and its messages are untouched for everyone else. Any member can leave. The last remaining member cannot leave (ask an organization owner/admin to archive instead), and direct rooms cannot be left.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(leftChatRoomSchema, "Left the room"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const { result, statusMessages } = await prisma.$transaction(async (tx) => {
      // Doubles as the membership check: it only resolves rooms the caller
      // actually belongs to, so leaving twice 404s.
      const existing = await requireChatRoomUserAccess(
        id,
        userContext.userId,
        tx,
      );

      // A DM is addressed by its participant set (`directKey`), which room
      // creation uses to reopen the same row. Dropping one side would leave
      // that key pointing at a conversation its own participant is no longer
      // in, so the DM could resurface with a broken roster.
      if (existing.kind === "direct") {
        throw badRequest("You cannot leave a direct room.");
      }

      // Serialize concurrent leaves so two "last but one" members cannot both
      // exit under READ COMMITTED and leave an empty roster. Matches the
      // FOR UPDATE pattern used on reaction toggles and coworker warmup.
      // Re-read archivedAt under the lock: a concurrent archive can commit
      // after the earlier access check and before we hold the row.
      const lockedRooms = await tx.$queryRaw<
        Array<{ id: string; archivedAt: Date | null }>
      >`
        SELECT "id", "archivedAt" FROM "chat_room"
        WHERE "id" = ${existing.id}::uuid
        FOR UPDATE
      `;
      if (lockedRooms.length === 0) {
        throw badRequest("Room could not be left.");
      }
      if (lockedRooms[0]?.archivedAt !== null) {
        throw notFound("Room not found");
      }

      // Re-count under the lock — the earlier include snapshot can be stale
      // once a concurrent leave has already deleted its row.
      const remainingUserMemberCount = await tx.chatRoomUserMember.count({
        where: {
          roomId: existing.id,
          userId: { not: userContext.userId },
        },
      });
      // Nobody left to archive it afterwards: the room would linger with an
      // empty roster, invisible to every user yet still holding its slug.
      // Last member cannot leave — an organization owner/admin (who must also
      // be members under current access rules) must archive instead.
      if (remainingUserMemberCount === 0) {
        throw badRequest(
          "You are the last member of this room. Ask an organization owner or admin to archive it.",
        );
      }

      const actor = await tx.user.findUnique({
        where: { id: userContext.userId },
        select: { name: true },
      });
      const actorName = actor?.name?.trim() || "Someone";

      const createdStatus = await recordChannelMembershipStatus(tx, {
        roomId: existing.id,
        roomKind: existing.kind,
        changes: [
          {
            action: "left",
            subject: {
              type: "user",
              id: userContext.userId,
              name: actorName,
            },
          },
        ],
      });

      await tx.chatRoomUserMember.deleteMany({
        where: { roomId: existing.id, userId: userContext.userId },
      });
      // Drop the read marker too, so rejoining later starts clean rather than
      // resuming a stale position.
      await tx.chatRoomReadState.deleteMany({
        where: { roomId: existing.id, userId: userContext.userId },
      });

      return {
        result: { id: existing.id, remainingUserMemberCount },
        statusMessages: createdStatus,
      };
    });

    // Membership already committed. Status timeline and multi-tab revoke must
    // not gate each other (or fail the leave after the row is gone).
    const [statusResults, revokeResult] = await Promise.allSettled([
      Promise.all(
        statusMessages.map((message) =>
          publishChatRoomMessageRealtime(message, "create"),
        ),
      ),
      publishChatMembershipRevoked({
        userId: userContext.userId,
        roomId: result.id,
        reason: "left",
      }),
    ]);
    if (statusResults.status === "rejected") {
      console.error(
        "Failed to publish chat membership status after leave",
        statusResults.reason,
      );
    }
    if (revokeResult.status === "rejected") {
      console.error(
        "Failed to publish chat membership revoke after leave",
        revokeResult.reason,
      );
    }

    return ok(c, leftChatRoomSchema.parse(result));
  });
}
