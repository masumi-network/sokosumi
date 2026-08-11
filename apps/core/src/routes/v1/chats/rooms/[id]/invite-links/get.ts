import { createRoute, z } from "@hono/zod-openapi";
import { chatRoomGuestInviteLinkRepository } from "@sokosumi/database/repositories";

import { toChatRoomGuestInviteLinkResponse } from "@/helpers/chat-room-guest-invite-link-response";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomGuestInviteLinkSchema } from "@/schemas/chat-room-guest-invite-link.schema";

import { requireRoomMemberCanInviteGuests } from "../../helpers";

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
    method: "get",
    path: "/{id}/invite-links",
    description:
      "List shareable guest invite links for an external channel. Caller must be a host-org room member (`access=member`). Sorted by createdAt descending (newest first).",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(chatRoomGuestInviteLinkSchema),
        "Shareable guest invite links",
      ),
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
    const { id: roomId } = c.req.valid("param");

    await requireRoomMemberCanInviteGuests(roomId, userContext.userId, prisma);

    const links =
      await chatRoomGuestInviteLinkRepository.listInviteLinksByRoomId(
        roomId,
        prisma,
      );

    return ok(
      c,
      z
        .array(chatRoomGuestInviteLinkSchema)
        .parse(links.map(toChatRoomGuestInviteLinkResponse)),
    );
  });
}
