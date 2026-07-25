import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  chatChannelMessageSchema,
  createChatChannelMessageRequestSchema,
} from "@/schemas/chat-channel.schema";
import { dispatchChatChannelMention } from "@/services/chat-channel-coworker-dispatch.service";

import {
  chatChannelMessageInclude,
  mapChatChannelMessage,
  requireChatChannelUserAccess,
  resolveMentionedCoworkerIds,
  resolveThreadReplyCoworkerMention,
} from "../../helpers";

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
    method: "post",
    path: "/{id}/messages",
    description:
      "Post a channel message. Mentioned AI coworkers are called asynchronously and reply into the channel.",
    tags: ["Chat Channels"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: createChatChannelMessageRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        chatChannelMessageSchema,
        "Channel message created",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Channel not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const { message, mentionIds } = await prisma.$transaction(async (tx) => {
      const channel = await requireChatChannelUserAccess(
        id,
        userContext.userId,
        tx,
      );
      const directCoworkerIds =
        channel.kind === "direct"
          ? channel.coworkerMembers.map(({ coworker }) => coworker.id)
          : [];
      const channelCoworkers = channel.coworkerMembers.map(({ coworker }) => ({
        id: coworker.id,
        name: coworker.name,
        slug: coworker.slug,
      }));
      const channelCoworkerIds = channelCoworkers.map(({ id }) => id);
      let implicitThreadMention: {
        coworkerId: string;
        providerConversationId: string | null;
      } | null = null;
      let parentMessageId: string | null = null;
      if (body.parentMessageId) {
        const parentMessage = await tx.chatChannelMessage.findFirst({
          where: {
            id: body.parentMessageId,
            channelId: channel.id,
          },
          select: {
            id: true,
            parentMessageId: true,
            senderCoworkerId: true,
            mentionResponseFor: {
              select: {
                coworkerId: true,
                providerConversationId: true,
              },
            },
          },
        });
        if (!parentMessage) {
          throw badRequest("Thread message not found");
        }
        parentMessageId = parentMessage.parentMessageId ?? parentMessage.id;
        implicitThreadMention = resolveThreadReplyCoworkerMention({
          parentMessage,
          channelCoworkerIds,
        });
      }
      const mentionedCoworkerIds = resolveMentionedCoworkerIds({
        content: body.content,
        explicitCoworkerIds: [
          ...(body.mentionedCoworkerIds ?? []),
          ...directCoworkerIds,
          ...(implicitThreadMention ? [implicitThreadMention.coworkerId] : []),
        ],
        channelCoworkers,
      });
      const providerConversationIdByCoworkerId = new Map<string, string>();
      if (implicitThreadMention?.providerConversationId) {
        providerConversationIdByCoworkerId.set(
          implicitThreadMention.coworkerId,
          implicitThreadMention.providerConversationId,
        );
      }

      const message = await tx.chatChannelMessage.create({
        data: {
          channelId: channel.id,
          parentMessageId,
          senderUserId: userContext.userId,
          content: body.content,
          mentionsAsSource: {
            create: mentionedCoworkerIds.map((coworkerId) => {
              const providerConversationId =
                providerConversationIdByCoworkerId.get(coworkerId);
              return {
                coworkerId,
                ...(providerConversationId && { providerConversationId }),
              };
            }),
          },
        },
        include: chatChannelMessageInclude,
      });

      await tx.chatChannel.update({
        where: { id: channel.id },
        data: { updatedAt: new Date() },
      });

      return {
        message,
        mentionIds: message.mentionsAsSource.map((mention) => mention.id),
      };
    });

    for (const mentionId of mentionIds) {
      waitUntil(dispatchChatChannelMention(mentionId));
    }

    return created(
      c,
      chatChannelMessageSchema.parse(
        mapChatChannelMessage(message, userContext.userId),
      ),
    );
  });
}
