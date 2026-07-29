import { createRoute, z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { leftChatRoomSchema } from "@/schemas/chat-room.schema";

import { requireChatRoomUserAccess } from "../../../helpers";

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
      "Leave an organization chat room. Removes only the caller's membership and read marker; the room and its messages are untouched for everyone else. Any member can leave. The last remaining member must archive the room instead, and direct rooms cannot be left.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(leftChatRoomSchema, "Left the room"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const result = await prisma.$transaction(async (tx) => {
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
      const lockedRooms = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "chat_room"
        WHERE "id" = ${existing.id}::uuid
        FOR UPDATE
      `;
      if (lockedRooms.length === 0) {
        throw badRequest("Room could not be left.");
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
      // Last member can archive instead (see archive/post.ts).
      if (remainingUserMemberCount === 0) {
        throw badRequest(
          "You are the last member of this room. Archive it instead of leaving.",
        );
      }

      await tx.chatRoomUserMember.deleteMany({
        where: { roomId: existing.id, userId: userContext.userId },
      });
      // Drop the read marker too, so rejoining later starts clean rather than
      // resuming a stale position.
      await tx.chatRoomReadState.deleteMany({
        where: { roomId: existing.id, userId: userContext.userId },
      });

      return { id: existing.id, remainingUserMemberCount };
    });

    return ok(c, leftChatRoomSchema.parse(result));
  });
}
