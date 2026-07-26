import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatChannelSchema,
  updateChatChannelRequestSchema,
} from "@/schemas/chat-channel.schema";

import {
  buildUniqueChannelSlug,
  chatChannelInclude,
  mapChatChannel,
  requireChatChannelUserAccess,
  slugifyChannelName,
  validateChatCoworkerIds,
  validateOrganizationUserIds,
} from "../helpers";

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
    method: "patch",
    path: "/{id}",
    description: "Update an organization chat channel and its roster.",
    tags: ["Chat Channels"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: updateChatChannelRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(chatChannelSchema, "Chat channel updated"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Channel not found"),
      409: jsonErrorResponse("Channel already exists"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const channel = await prisma.$transaction(async (tx) => {
        const existing = await requireChatChannelUserAccess(
          id,
          userContext.userId,
          tx,
        );

        // A direct channel's identity IS its participant set: `directKey` is
        // derived from it, and `direct/post.ts` resolves an existing DM by that
        // key alone. Renaming one or rewriting its roster here would leave the
        // key pointing at a membership that no longer matches, so reopening the
        // DM could hand someone a conversation they are no longer part of.
        // Direct channels are created, never edited.
        if (existing.kind === "direct") {
          throw badRequest("Direct channels cannot be edited.");
        }

        const updateData: {
          name?: string;
          slug?: string;
          topic?: string | null;
        } = {};

        if (body.name !== undefined) {
          updateData.name = body.name;
          const nextBaseSlug = slugifyChannelName(body.name);
          if (nextBaseSlug !== existing.slug) {
            updateData.slug = await buildUniqueChannelSlug(
              existing.organizationId,
              body.name,
              tx,
            );
          }
        }

        if (body.topic !== undefined) {
          updateData.topic = body.topic?.trim() || null;
        }

        if (body.memberUserIds !== undefined) {
          const memberUserIds = await validateOrganizationUserIds(
            existing.organizationId,
            [userContext.userId, ...body.memberUserIds],
            tx,
          );
          await tx.chatChannelUserMember.deleteMany({
            where: { channelId: existing.id },
          });
          await tx.chatChannelReadState.deleteMany({
            where: {
              channelId: existing.id,
              userId: { notIn: memberUserIds },
            },
          });
          for (const memberUserId of memberUserIds) {
            await tx.chatChannelUserMember.create({
              data: {
                channelId: existing.id,
                userId: memberUserId,
              },
            });
          }
          await tx.chatChannelReadState.createMany({
            data: memberUserIds.map((memberUserId) => ({
              channelId: existing.id,
              userId: memberUserId,
            })),
            skipDuplicates: true,
          });
        }

        if (body.coworkerIds !== undefined) {
          const coworkerIds = await validateChatCoworkerIds(
            body.coworkerIds,
            tx,
          );
          await tx.chatChannelCoworkerMember.deleteMany({
            where: { channelId: existing.id },
          });
          for (const coworkerId of coworkerIds) {
            await tx.chatChannelCoworkerMember.create({
              data: {
                channelId: existing.id,
                coworkerId,
              },
            });
          }
        }

        return tx.chatChannel.update({
          where: { id: existing.id },
          data: updateData,
          include: chatChannelInclude,
        });
      });

      return ok(
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
