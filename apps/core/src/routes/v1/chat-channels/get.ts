import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { chatChannelSchema } from "@/schemas/chat-channel.schema";

import {
  chatChannelInclude,
  getChatChannelUnreadCounts,
  mapChatChannel,
} from "./helpers";

const querySchema = z.object({
  organizationId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "organizationId", in: "query" },
      example: "org_123",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List organization chat channels visible to the current organization member.",
    tags: ["Chat Channels"],
    request: {
      query: querySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(chatChannelSchema),
        "List chat channels",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Organization not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { organizationId } = c.req.valid("query");

    const { channels, unreadCounts } = await prisma.$transaction(async (tx) => {
      await resolveMemberOrganizationById({
        id: organizationId,
        userId: userContext.userId,
        tx,
      });

      const channels = await tx.chatChannel.findMany({
        where: {
          organizationId,
          archivedAt: null,
          userMembers: {
            some: { userId: userContext.userId },
          },
        },
        include: chatChannelInclude,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });

      const unreadCounts = await getChatChannelUnreadCounts(
        channels.map((channel) => channel.id),
        userContext.userId,
        tx,
      );

      return { channels, unreadCounts };
    });

    return ok(
      c,
      z
        .array(chatChannelSchema)
        .parse(
          channels.map((channel) =>
            mapChatChannel(
              channel,
              userContext.userId,
              unreadCounts.get(channel.id) ?? 0,
            ),
          ),
        ),
    );
  });
}
