import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  reorderStarredChatRoomsRequestSchema,
  starredChatRoomOrderSchema,
} from "@/schemas/chat-room.schema";

const route = createRoute({
  method: "put",
  path: "/starred",
  description:
    "Set the order of the current user's starred chat rooms. Rewrites `starredAt`, the sort key every client already lists starred rooms by (oldest first). Never stars or unstars a room.",
  tags: ["Chat Rooms"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: reorderStarredChatRoomsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.array(starredChatRoomOrderSchema),
      "Starred rooms in their new order",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { roomIds } = c.req.valid("json");

    const order = await prisma.$transaction(async (tx) => {
      const starred = await tx.chatRoomUserMember.findMany({
        where: { userId, starredAt: { not: null } },
        orderBy: [{ starredAt: "asc" }, { roomId: "asc" }],
        select: { roomId: true, starredAt: true },
      });
      const starredIds = new Set(starred.map((row) => row.roomId));
      // Listed starred ids first (deduped), then the rest in their old order.
      const ordered = [
        ...new Set([
          ...roomIds.filter((id) => starredIds.has(id)),
          ...starredIds,
        ]),
      ];

      if (ordered.every((roomId, index) => roomId === starred[index]?.roomId)) {
        return starred;
      }

      // One millisecond apart, all in the past, so a room starred right after
      // this still lands at the end.
      const base = Date.now() - ordered.length;
      const rows = ordered.map((roomId, index) => ({
        roomId,
        starredAt: new Date(base + index),
      }));
      for (const row of rows) {
        // `starredAt: not null` again: a room unstarred since the read above
        // stays unstarred, and a membership that went away is no error.
        await tx.chatRoomUserMember.updateMany({
          where: { roomId: row.roomId, userId, starredAt: { not: null } },
          data: { starredAt: row.starredAt },
        });
      }
      return rows;
    });

    return ok(c, z.array(starredChatRoomOrderSchema).parse(order));
  });
}
