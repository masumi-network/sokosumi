import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { chatRoomGuestInviteLinkRepository } from "@sokosumi/database/repositories";
import { evaluateInviteLinkStatus } from "@sokosumi/utils";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { resolveChatRoomGuestInviteLinkResponseSchema } from "@/schemas/chat-room-guest-invite-link.schema";

const params = z.object({
  token: z
    .string()
    .min(1)
    .openapi({
      param: { name: "token", in: "path" },
      description: "Invite link capability token from the /chat/join URL",
    }),
});

const route = createRoute({
  method: "get",
  path: "/{token}",
  description:
    "Resolve a shareable external-channel guest invite link for the /chat/join preview. Public: the token is the capability, so the page renders while logged out. Room details are returned only for a live (`valid`) link; invalid tokens yield just a status.",
  tags: ["Chat Room Invite Links"],
  security: [],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      resolveChatRoomGuestInviteLinkResponseSchema,
      "The invite link status and (when valid) a room preview",
    ),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { token } = c.req.valid("param");
    const link = await chatRoomGuestInviteLinkRepository.getInviteLinkByToken(
      token,
      prisma,
    );
    const status = evaluateInviteLinkStatus(link, new Date());

    if (status !== "valid" || !link) {
      return ok(
        c,
        resolveChatRoomGuestInviteLinkResponseSchema.parse({
          status,
          room: null,
        }),
      );
    }

    const room = await prisma.chatRoom.findUnique({
      where: { id: link.roomId },
      select: {
        id: true,
        name: true,
        kind: true,
        discoverability: true,
        archivedAt: true,
        organizationId: true,
        organization: { select: { id: true, name: true } },
      },
    });

    if (
      !room ||
      room.archivedAt !== null ||
      room.kind !== "channel" ||
      room.discoverability !== "external" ||
      !room.organizationId ||
      !room.organization
    ) {
      return ok(
        c,
        resolveChatRoomGuestInviteLinkResponseSchema.parse({
          status: "not_found",
          room: null,
        }),
      );
    }

    return ok(
      c,
      resolveChatRoomGuestInviteLinkResponseSchema.parse({
        status: "valid",
        room: {
          id: room.id,
          name: room.name,
          organizationId: room.organizationId,
          organizationName: room.organization.name,
        },
      }),
    );
  });
}
