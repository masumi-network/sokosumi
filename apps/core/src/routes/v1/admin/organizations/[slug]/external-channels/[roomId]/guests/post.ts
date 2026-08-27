import { createRoute } from "@hono/zod-openapi";

import { getAdminOrganizationBySlug } from "@/helpers/admin-organization-overview.js";
import { joinExternalChannelAsGuest } from "@/helpers/chat-room-guest-membership";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminAddExternalChannelGuestBodySchema,
  adminAddExternalChannelGuestParamsSchema,
  adminExternalChannelGuestSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "post",
  path: "/{slug}/external-channels/{roomId}/guests",
  operationId: "addAdminExternalChannelGuest",
  description:
    "Add an existing platform user to an organization External channel as a guest (admin only). Creates `ChatRoomUserMember` with `access=guest` immediately (no invite, no org Member / seat). Rejects host-org members. Idempotent when already a guest.",
  tags: ["Admin"],
  request: {
    params: adminAddExternalChannelGuestParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: adminAddExternalChannelGuestBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminExternalChannelGuestSchema,
      "Guest membership ensured",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug, roomId } = c.req.valid("param");
    const { userId } = c.req.valid("json");

    const organization = await getAdminOrganizationBySlug(slug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    const { result, statusMessages } = await prisma.$transaction(async (tx) =>
      joinExternalChannelAsGuest(tx, {
        userId,
        roomId,
        organizationId: organization.id,
      }),
    );

    for (const message of statusMessages) {
      await publishChatRoomMessageRealtime(message, "create");
    }

    return ok(
      c,
      adminExternalChannelGuestSchema.parse({
        userId: result.userId,
        roomId: result.roomId,
        access: result.access,
      }),
    );
  });
}
