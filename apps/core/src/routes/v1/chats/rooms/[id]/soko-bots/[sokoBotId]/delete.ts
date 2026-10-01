import { createRoute, z } from "@hono/zod-openapi";

import { failOpenChatRoomMentions } from "@/helpers/chat-room-mention-status";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomSchema } from "@/schemas/chat-room.schema";

import {
  ASSISTANT_GONE,
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
  sokoBotId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "sokoBotId", in: "path" },
      example: "01960001-0001-7001-8001-000000000099",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/soko-bots/{sokoBotId}",
    description:
      "Remove your own Soko Bot from a Channel. Only its owner may remove it; it also leaves when its owner leaves or is removed.",
    tags: ["Chat Rooms"],
    request: { params: paramsSchema },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Soko Bot removed"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room or Soko Bot not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, sokoBotId } = c.req.valid("param");

    const { room, statusMessages, mentionMessageIds } =
      await prisma.$transaction(async (tx) => {
        const { room: existing, actor } = await requireChannelRosterAccess(
          tx,
          id,
          userContext.userId,
        );
        const member = existing.sokoBotMembers.find(
          (candidate) => candidate.sokoBot.id === sokoBotId,
        );
        if (!member) {
          throw notFound("Soko Bot is not a member of this room");
        }
        if (member.sokoBot.userId !== userContext.userId) {
          throw forbidden("Only the owner can remove this personal assistant");
        }

        const mentionMessageIds = await failOpenChatRoomMentions(
          {
            where: { sokoBotId, message: { roomId: existing.id } },
            error: ASSISTANT_GONE,
          },
          tx,
        );
        await tx.chatRoomSokoBotMember.deleteMany({
          where: { roomId: existing.id, sokoBotId },
        });
        const statusMessages = await recordChannelMembershipStatus(tx, {
          roomId: existing.id,
          roomKind: existing.kind,
          changes: [
            {
              action: "left",
              subject: {
                type: "sokoBot",
                id: sokoBotId,
                name: sokoBotDisplayName(member.sokoBot),
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
      });

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
