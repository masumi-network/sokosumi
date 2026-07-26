import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { waitUntil } from "@vercel/functions";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  isCoworkerAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
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
      "Post a channel message. Mentioned AI coworkers — and, for thread replies, every coworker already part of the thread — are called asynchronously and reply into the channel. Coworker API keys may post as the coworker itself into channels it is a member of.",
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

async function resolveThreadParentMessageId(
  tx: Prisma.TransactionClient,
  channelId: string,
  requestedParentMessageId: string | undefined,
): Promise<string | null> {
  if (!requestedParentMessageId) {
    return null;
  }
  const parentMessage = await tx.chatChannelMessage.findFirst({
    where: {
      id: requestedParentMessageId,
      channelId,
    },
    select: {
      id: true,
      parentMessageId: true,
    },
  });
  if (!parentMessage) {
    throw badRequest("Thread message not found");
  }
  return parentMessage.parentMessageId ?? parentMessage.id;
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = c.var.authContext;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // A coworker posts as itself into channels it belongs to. Its messages
    // never create mention rows — nothing to poll, and no coworker→coworker
    // dispatch loops.
    if (isCoworkerAuthContext(authContext)) {
      const coworkerId = authContext.coworkerId;
      const message = await prisma.$transaction(async (tx) => {
        const channel = await tx.chatChannel.findFirst({
          where: {
            id,
            archivedAt: null,
            coworkerMembers: {
              some: { coworkerId },
            },
          },
          select: { id: true },
        });
        if (!channel) {
          throw notFound("Channel not found");
        }

        const parentMessageId = await resolveThreadParentMessageId(
          tx,
          channel.id,
          body.parentMessageId,
        );

        const message = await tx.chatChannelMessage.create({
          data: {
            channelId: channel.id,
            parentMessageId,
            senderCoworkerId: coworkerId,
            content: body.content,
          },
          include: chatChannelMessageInclude,
        });

        await tx.chatChannel.update({
          where: { id: channel.id },
          data: { updatedAt: new Date() },
        });

        return message;
      });

      return created(
        c,
        chatChannelMessageSchema.parse(mapChatChannelMessage(message)),
      );
    }

    const userContext = requireUserAuthContext(authContext);

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

      const parentMessageId = await resolveThreadParentMessageId(
        tx,
        channel.id,
        body.parentMessageId,
      );

      // A thread reply goes to every coworker already part of the thread —
      // as a sender or a mention target — without requiring a fresh @mention.
      let threadCoworkerIds: string[] = [];
      if (parentMessageId) {
        const threadMessages = await tx.chatChannelMessage.findMany({
          where: {
            channelId: channel.id,
            OR: [{ id: parentMessageId }, { parentMessageId }],
          },
          select: {
            senderCoworkerId: true,
            mentionsAsSource: { select: { coworkerId: true } },
          },
        });
        threadCoworkerIds = threadMessages.flatMap((threadMessage) => [
          ...(threadMessage.senderCoworkerId
            ? [threadMessage.senderCoworkerId]
            : []),
          ...threadMessage.mentionsAsSource.map(
            (mention) => mention.coworkerId,
          ),
        ]);
      }

      const mentionedCoworkerIds = resolveMentionedCoworkerIds({
        content: body.content,
        explicitCoworkerIds: [
          ...(body.mentionedCoworkerIds ?? []),
          ...directCoworkerIds,
          ...threadCoworkerIds,
        ],
        channelCoworkers: channel.coworkerMembers.map(({ coworker }) => ({
          id: coworker.id,
          name: coworker.name,
          slug: coworker.slug,
        })),
      });

      const message = await tx.chatChannelMessage.create({
        data: {
          channelId: channel.id,
          parentMessageId,
          senderUserId: userContext.userId,
          content: body.content,
          mentionsAsSource: {
            create: mentionedCoworkerIds.map((coworkerId) => ({
              coworkerId,
            })),
          },
        },
        include: chatChannelMessageInclude,
      });

      await tx.chatChannel.update({
        where: { id: channel.id },
        data: { updatedAt: new Date() },
      });
      await tx.chatChannelReadState.upsert({
        where: {
          channelId_userId: {
            channelId: channel.id,
            userId: userContext.userId,
          },
        },
        update: { lastReadAt: message.createdAt },
        create: {
          channelId: channel.id,
          userId: userContext.userId,
          lastReadAt: message.createdAt,
        },
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
