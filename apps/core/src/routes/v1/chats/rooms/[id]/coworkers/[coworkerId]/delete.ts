import { createRoute, z } from "@hono/zod-openapi";

import { failOpenChatRoomMentions } from "@/helpers/chat-room-mention-status";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomSchema } from "@/schemas/chat-room.schema";

import {
  publishChannelMembershipEffects,
  requireChannelRosterAccess,
} from "../../../channel-membership";
import { chatRoomInclude, mapChatRoomWithSidebarFlags } from "../../../helpers";
import { recordChannelMembershipStatus } from "../../../membership-status";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  coworkerId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "coworkerId", in: "path" },
      example: "cow_123",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/coworkers/{coworkerId}",
    description:
      "Remove a Coworker from a Channel. Any host member (`access=member`) may remove one; Guests may not. Its open mentions in the Channel fail so a queued reply cannot post after it left.",
    tags: ["Chat Rooms"],
    request: { params: paramsSchema },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Coworker removed"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonErrorResponse("Concurrent membership change"),
      404: jsonErrorResponse("Room or Coworker not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, coworkerId } = c.req.valid("param");

    const { room, statusMessages, mentionMessageIds } =
      await serializableTransaction(async (tx) => {
        const { room: existing, actor } = await requireChannelRosterAccess(
          tx,
          id,
          userContext.userId,
        );
        const member = existing.coworkerMembers.find(
          (candidate) => candidate.coworker.id === coworkerId,
        );
        if (!member) {
          throw notFound("Coworker is not a member of this room");
        }

        const mentionMessageIds = await failOpenChatRoomMentions(
          {
            where: { coworkerId, message: { roomId: existing.id } },
            error: "Coworker is no longer a member of this room",
          },
          tx,
        );
        await tx.chatRoomCoworkerMember.deleteMany({
          where: { roomId: existing.id, coworkerId },
        });
        const statusMessages = await recordChannelMembershipStatus(tx, {
          roomId: existing.id,
          roomKind: existing.kind,
          changes: [
            {
              action: "left",
              subject: {
                type: "coworker",
                id: coworkerId,
                name: member.coworker.name,
              },
              actor,
            },
          ],
        });
        return {
          room: await tx.chatRoom.findUniqueOrThrow({
            where: { id: existing.id },
            include: chatRoomInclude,
          }),
          statusMessages,
          mentionMessageIds,
        };
      }, "Channel membership changed concurrently. Please try again.");

    await publishChannelMembershipEffects({
      roomId: room.id,
      statusMessages,
      mentionMessageIds,
    });

    return ok(
      c,
      chatRoomSchema.parse(
        await mapChatRoomWithSidebarFlags(room, userContext.userId, prisma),
      ),
    );
  });
}
