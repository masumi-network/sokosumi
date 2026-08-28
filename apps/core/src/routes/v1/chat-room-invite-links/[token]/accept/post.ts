import { createRoute, z } from "@hono/zod-openapi";
import { chatRoomGuestInviteLinkRepository } from "@sokosumi/database/repositories";
import { evaluateInviteLinkStatus } from "@sokosumi/utils";

import { joinExternalChannelAsGuest } from "@/helpers/chat-room-guest-membership";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { acceptChatRoomGuestInviteLinkResponseSchema } from "@/schemas/chat-room-guest-invite-link.schema";

const params = z.object({
  token: z
    .string()
    .min(1)
    .openapi({
      param: { name: "token", in: "path" },
      description: "Invite link capability token from the /chat/join URL",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{token}/accept",
    description:
      "Join an external channel as a guest via a shareable invite link. Creates `ChatRoomUserMember` with `access=guest` (no org Member / seat). Rejects host-org members (they self-join as members). Idempotent when already a guest. Rejects expired / revoked / depleted links.",
    tags: ["Chat Room Invite Links"],
    request: { params },
    responses: {
      200: jsonSuccessResponse(
        acceptChatRoomGuestInviteLinkResponseSchema,
        "Joined, or already a guest",
      ),
      400: jsonErrorResponse(
        "Bad Request - link expired, revoked, or depleted",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse(
        "Forbidden - session user required (coworker/orchestrator rejected)",
      ),
      404: jsonErrorResponse("Not Found - invalid link or room"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Session-only: a coworker/orchestrator key must not enroll an arbitrary user.
    const userContext = requireUserAuthContext(c.var.authContext);
    const { token } = c.req.valid("param");
    const now = new Date();

    const link = await chatRoomGuestInviteLinkRepository.getInviteLinkByToken(
      token,
      prisma,
    );
    const status = evaluateInviteLinkStatus(link, now);
    if (!link || status === "not_found") {
      throw notFound("This invite link is not valid.");
    }
    if (status !== "valid") {
      throw badRequest(
        status === "expired"
          ? "This invite link has expired."
          : status === "revoked"
            ? "This invite link has been revoked."
            : "This invite link has reached its usage limit.",
      );
    }

    const { result, statusMessages } = await prisma.$transaction(async (tx) =>
      joinExternalChannelAsGuest(tx, {
        userId: userContext.userId,
        roomId: link.roomId,
        roomUnavailableMessage:
          "Room is no longer available for guest invitations.",
        beforeCreate: async () => {
          const consumed =
            await chatRoomGuestInviteLinkRepository.tryConsumeInviteLink(
              { id: link.id, now, maxUses: link.maxUses },
              tx,
            );
          return consumed ? "continue" : "abort";
        },
      }),
    );

    if (result.outcome === "aborted") {
      throw badRequest("This invite link has reached its usage limit.");
    }

    for (const message of statusMessages) {
      await publishChatRoomMessageRealtime(message, "create");
    }

    return ok(
      c,
      acceptChatRoomGuestInviteLinkResponseSchema.parse({
        status: result.outcome === "joined" ? "joined" : "already_guest",
        roomId: result.roomId,
        roomName: result.roomName,
      }),
    );
  });
}
