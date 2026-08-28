import { createRoute } from "@hono/zod-openapi";

import { getAdminOrganizationBySlug } from "@/helpers/admin-organization-overview.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminExternalChannelDetailSchema,
  adminExternalChannelRoomParamsSchema,
} from "@/schemas/admin.schema";
import { CHAT_ROOM_ACCESS } from "@/schemas/chat-room.schema";

const route = createRoute({
  method: "get",
  path: "/{slug}/external-channels/{roomId}",
  operationId: "getAdminOrgExternalChannel",
  description:
    "Get one live External channel owned by the organization, including guest roster (admin only). Returns 404 when the room is missing, archived, not external, or belongs to another org.",
  tags: ["Admin"],
  request: {
    params: adminExternalChannelRoomParamsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminExternalChannelDetailSchema,
      "External channel detail",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug, roomId } = c.req.valid("param");

    const organization = await getAdminOrganizationBySlug(slug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    const room = await prisma.chatRoom.findFirst({
      where: {
        id: roomId,
        organizationId: organization.id,
        kind: "channel",
        discoverability: "external",
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        topic: true,
        userMembers: {
          where: { access: CHAT_ROOM_ACCESS.GUEST },
          select: {
            userId: true,
            user: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!room || !room.slug) {
      throw notFound("Room not found");
    }

    return ok(
      c,
      adminExternalChannelDetailSchema.parse({
        id: room.id,
        name: room.name,
        slug: room.slug,
        topic: room.topic,
        guests: room.userMembers.map((member) => ({
          userId: member.userId,
          name: member.user.name,
          email: member.user.email,
        })),
      }),
    );
  });
}
