import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatChannelSchema,
  createChatChannelRequestSchema,
} from "@/schemas/chat-channel.schema";

import {
  buildUniqueChannelSlug,
  chatChannelInclude,
  mapChatChannel,
  validateChatCoworkerIds,
  validateOrganizationUserIds,
} from "./helpers";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description:
      "Create an organization chat channel with human and AI coworker members.",
    tags: ["Chat Channels"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: createChatChannelRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(chatChannelSchema, "Chat channel created"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Organization not found"),
      409: jsonErrorResponse("Channel already exists"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");

    try {
      const channel = await prisma.$transaction(async (tx) => {
        await resolveMemberOrganizationById({
          id: body.organizationId,
          userId: userContext.userId,
          tx,
        });

        const memberUserIds = await validateOrganizationUserIds(
          body.organizationId,
          [userContext.userId, ...(body.memberUserIds ?? [])],
          tx,
        );
        const coworkerIds = await validateChatCoworkerIds(
          body.coworkerIds ?? [],
          tx,
        );
        const slug = await buildUniqueChannelSlug(
          body.organizationId,
          body.name,
          tx,
        );

        return tx.chatChannel.create({
          data: {
            organizationId: body.organizationId,
            createdByUserId: userContext.userId,
            name: body.name,
            slug,
            topic: body.topic?.trim() || null,
            userMembers: {
              create: memberUserIds.map((userId) => ({ userId })),
            },
            readStates: {
              create: memberUserIds.map((userId) => ({ userId })),
            },
            coworkerMembers: {
              create: coworkerIds.map((coworkerId) => ({ coworkerId })),
            },
          },
          include: chatChannelInclude,
        });
      });

      return created(
        c,
        chatChannelSchema.parse(mapChatChannel(channel, userContext.userId)),
      );
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        throw conflict("Channel already exists");
      }
      throw error;
    }
  });
}
