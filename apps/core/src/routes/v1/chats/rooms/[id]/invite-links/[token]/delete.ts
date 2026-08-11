import { createRoute, z } from "@hono/zod-openapi";
import { chatRoomGuestInviteLinkRepository } from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

import { requireRoomMemberCanInviteGuests } from "../../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  token: z
    .string()
    .min(1)
    .openapi({
      param: { name: "token", in: "path" },
      description: "Invite link capability token to revoke",
    }),
});

const responseSchema = z
  .object({ ok: z.boolean() })
  .openapi("RevokeChatRoomGuestInviteLinkResult");

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/invite-links/{token}",
    description:
      "Revoke a shareable guest invite link so it can no longer be used to join. Caller must be a host-org room member (`access=member`).",
    tags: ["Chat Rooms"],
    request: { params: paramsSchema },
    responses: {
      200: jsonSuccessResponse(responseSchema, "Revoked"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id: roomId, token } = c.req.valid("param");

    await requireRoomMemberCanInviteGuests(roomId, userContext.userId, prisma);

    const link = await chatRoomGuestInviteLinkRepository.getInviteLinkByToken(
      token,
      prisma,
    );
    // Scope token to the path room so a host of room A cannot revoke a link
    // belonging to room B by guessing its token.
    if (!link || link.roomId !== roomId) {
      throw notFound("Invite link not found");
    }

    if (!link.revokedAt) {
      await chatRoomGuestInviteLinkRepository.revokeInviteLink(
        link.id,
        new Date(),
        prisma,
      );
    }

    return ok(c, responseSchema.parse({ ok: true }));
  });
}
