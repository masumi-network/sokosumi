import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";
import {
  emitChatDirectMessageNotifications,
  shouldEmitChatDirectMessageNotifications,
} from "@/helpers/chat-direct-message-notifications";
import { emitChatMentionNotifications } from "@/helpers/chat-mention-notifications";
import { emitChatRoomMessageNotifications } from "@/helpers/chat-room-message-notifications";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  isCoworkerAuthContext,
  isOrchestratorAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import {
  chatRoomMessageSchema,
  createChatRoomMessageRequestSchema,
} from "@/schemas/chat-room.schema";
import { dispatchChatRoomMention } from "@/services/chat-room-coworker-dispatch.service";
import { scheduleChatRoomMessageUnfurls } from "@/services/chat-room-message-unfurl.service";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  markChatRoomThreadRead,
  mergeChatRoomMessageMetadata,
  orchestratorDisplayName,
  requireChatRoomCoworkerAccess,
  requireChatRoomOrchestratorAccess,
  requireChatRoomUserWriteAccess,
  resolveMentionedCoworkerIds,
  resolveMentionedOrchestratorIds,
  resolveMentionedUserIds,
  resolveRoomQuoteSnapshot,
  resolveThreadParentMessageId,
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
      "Post a room message. Mentioned AI coworkers and personal assistants are called asynchronously and reply into the room. Agent API keys may post as their coworker or orchestrator identity into rooms it belongs to. Agent posts into a Direct with at most two human members emit the same CHAT Direct notification as a human sender.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: createChatRoomMessageRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(chatRoomMessageSchema, "Room message created"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      409: jsonErrorResponse("Conflict"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = c.var.authContext;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    if (
      isCoworkerAuthContext(authContext) ||
      isOrchestratorAuthContext(authContext)
    ) {
      const persisted = await prisma.$transaction(async (tx) => {
        const room = isCoworkerAuthContext(authContext)
          ? await requireChatRoomCoworkerAccess(id, authContext.coworkerId, tx)
          : await requireChatRoomOrchestratorAccess(
              id,
              authContext.orchestratorId,
              tx,
            );

        const parentMessageId = await resolveThreadParentMessageId(
          tx,
          room.id,
          body.parentMessageId,
        );
        const quote = await resolveRoomQuoteSnapshot(
          tx,
          room.id,
          body.quote?.messageId,
        );
        const metadata = mergeChatRoomMessageMetadata(null, quote);

        const message = await tx.chatRoomMessage.create({
          data: {
            roomId: room.id,
            parentMessageId,
            senderCoworkerId: isCoworkerAuthContext(authContext)
              ? authContext.coworkerId
              : null,
            senderOrchestratorId: isOrchestratorAuthContext(authContext)
              ? authContext.orchestratorId
              : null,
            content: body.content,
            ...(metadata ? { metadata } : {}),
          },
          include: chatRoomMessageInclude,
        });

        await tx.chatRoom.update({
          where: { id: room.id },
          data: { updatedAt: new Date() },
        });

        return { message, room };
      });

      const { message, room } = persisted;

      await publishChatRoomMessageRealtime(message, "create");

      waitUntil(scheduleChatRoomMessageUnfurls(message.id));

      // Only a direct room needs the roster here, to count the humans in it.
      // A channel leaves the read to the emitter, which runs after the
      // response rather than in front of it.
      const memberUserIds =
        room.kind === "direct"
          ? (
              await prisma.chatRoomUserMember.findMany({
                where: { roomId: room.id },
                select: { userId: true },
              })
            ).map((member) => member.userId)
          : undefined;

      // The author is a coworker or the orchestrator, never a human, so the
      // name comes from whichever one sent it.
      const authorName = message.senderOrchestrator
        ? orchestratorDisplayName(message.senderOrchestrator)
        : (message.senderCoworker?.name ?? "Someone");

      if (
        memberUserIds &&
        shouldEmitChatDirectMessageNotifications({
          kind: room.kind,
          memberUserIds,
        })
      ) {
        waitUntil(
          emitChatDirectMessageNotifications({
            roomId: room.id,
            roomName: room.name,
            organizationId: room.organizationId,
            messageId: message.id,
            authorUserId: null,
            authorName,
            recipientUserIds: memberUserIds,
          }),
        );
      }

      waitUntil(
        emitChatRoomMessageNotifications({
          roomId: room.id,
          roomName: room.name,
          roomKind: room.kind,
          organizationId: room.organizationId,
          messageId: message.id,
          authorUserId: null,
          authorName,
          // Already read for the direct-message decision, so the emitter is
          // not asked to read the same roster again.
          memberUserIds,
        }),
      );

      return created(
        c,
        chatRoomMessageSchema.parse(mapChatRoomMessage(message)),
      );
    }

    const userContext = requireUserAuthContext(authContext);
    const trimmedClientId =
      typeof body.clientMessageId === "string"
        ? body.clientMessageId.trim()
        : "";
    const clientId = trimmedClientId.length > 0 ? trimmedClientId : null;

    let persisted;
    try {
      persisted = await prisma.$transaction(async (tx) => {
        const room = await requireChatRoomUserWriteAccess(
          id,
          userContext.userId,
          tx,
        );

        if (clientId) {
          const existing = await tx.chatRoomMessage.findUnique({
            where: {
              roomId_clientMessageId: {
                roomId: room.id,
                clientMessageId: clientId,
              },
            },
            include: chatRoomMessageInclude,
          });
          if (existing) {
            if (existing.senderUserId !== userContext.userId) {
              throw conflict(
                "clientMessageId already used by another sender in this room",
              );
            }
            return {
              message: existing,
              mentionIds: [] as string[],
              mentionedUserIds: [] as string[],
              room: {
                id: room.id,
                name: room.name,
                organizationId: room.organizationId,
                kind: room.kind,
                memberUserIds: room.userMembers.map((member) => member.userId),
              },
              didCreate: false,
            };
          }
        }

        // A Soko Bot direct is mention-driven (its reply is a Core turn),
        // so it never takes the coworker stream shortcut.
        const skipCoworkerMentions =
          room.kind === "direct" &&
          room.coworkerMembers.length === 1 &&
          room.orchestratorMembers.length === 0 &&
          room.userMembers.length === 1 &&
          room.userMembers[0]?.userId === userContext.userId;

        const directCoworkerIds =
          room.kind === "direct" && !skipCoworkerMentions
            ? room.coworkerMembers.map(({ coworker }) => coworker.id)
            : [];
        const directOrchestratorIds =
          room.kind === "direct" &&
          room.orchestratorMembers.length === 1 &&
          room.coworkerMembers.length === 0
            ? room.orchestratorMembers.map(
                ({ orchestrator }) => orchestrator.id,
              )
            : [];

        const parentMessageId = await resolveThreadParentMessageId(
          tx,
          room.id,
          body.parentMessageId,
        );
        const quote = await resolveRoomQuoteSnapshot(
          tx,
          room.id,
          body.quote?.messageId,
        );
        const metadata = mergeChatRoomMessageMetadata(
          clientId ? { client_message_id: clientId } : null,
          quote,
        );

        // A thread reply goes to every coworker already part of the thread —
        // as a sender or a mention target — without requiring a fresh @mention.
        let threadCoworkerIds: string[] = [];
        let threadOrchestratorIds: string[] = [];
        if (parentMessageId) {
          const threadMessages = await tx.chatRoomMessage.findMany({
            where: {
              roomId: room.id,
              OR: [{ id: parentMessageId }, { parentMessageId }],
            },
            select: {
              senderCoworkerId: true,
              senderOrchestratorId: true,
              mentionsAsSource: {
                select: { coworkerId: true, orchestratorId: true },
              },
            },
          });
          threadCoworkerIds = threadMessages.flatMap((threadMessage) => [
            ...(threadMessage.senderCoworkerId
              ? [threadMessage.senderCoworkerId]
              : []),
            ...threadMessage.mentionsAsSource.flatMap((mention) =>
              mention.coworkerId ? [mention.coworkerId] : [],
            ),
          ]);
          threadOrchestratorIds = threadMessages.flatMap((threadMessage) => [
            ...(threadMessage.senderOrchestratorId
              ? [threadMessage.senderOrchestratorId]
              : []),
            ...threadMessage.mentionsAsSource.flatMap((mention) =>
              mention.orchestratorId ? [mention.orchestratorId] : [],
            ),
          ]);
        }

        const mentionedCoworkerIds = skipCoworkerMentions
          ? []
          : resolveMentionedCoworkerIds({
              content: body.content,
              explicitCoworkerIds: [
                ...(body.mentionedCoworkerIds ?? []),
                ...directCoworkerIds,
                ...threadCoworkerIds,
              ],
              roomCoworkers: room.coworkerMembers.map(({ coworker }) => ({
                id: coworker.id,
                name: coworker.name,
                slug: coworker.slug,
              })),
            });
        const mentionedOrchestratorIds = resolveMentionedOrchestratorIds({
          content: body.content,
          explicitOrchestratorIds: [
            ...(body.mentionedOrchestratorIds ?? []),
            ...directOrchestratorIds,
            ...threadOrchestratorIds,
          ],
          roomOrchestrators: room.orchestratorMembers.map(
            ({ orchestrator }) => ({
              id: orchestrator.id,
              name: orchestratorDisplayName(orchestrator),
            }),
          ),
        });

        const mentionedUserIds = resolveMentionedUserIds({
          content: body.content,
          explicitUserIds: body.mentionedUserIds ?? [],
          roomUsers: room.userMembers.map(({ userId, user }) => ({
            id: userId,
            name: user.name,
          })),
          excludeUserId: userContext.userId,
        });

        const message = await tx.chatRoomMessage.create({
          data: {
            roomId: room.id,
            parentMessageId,
            senderUserId: userContext.userId,
            content: body.content,
            ...(clientId ? { clientMessageId: clientId } : {}),
            ...(metadata ? { metadata } : {}),
            mentionsAsSource: {
              create: [
                ...mentionedCoworkerIds.map((coworkerId) => ({
                  coworkerId,
                  orchestratorId: null,
                })),
                ...mentionedOrchestratorIds.map((orchestratorId) => ({
                  coworkerId: null,
                  orchestratorId,
                })),
              ],
            },
            userMentionsAsSource: {
              create: mentionedUserIds.map((mentionedUserId) => ({
                userId: mentionedUserId,
              })),
            },
          },
          include: chatRoomMessageInclude,
        });

        await tx.chatRoom.update({
          where: { id: room.id },
          data: { updatedAt: new Date() },
        });
        await tx.chatRoomReadState.upsert({
          where: {
            roomId_userId: {
              roomId: room.id,
              userId: userContext.userId,
            },
          },
          update: { lastReadAt: message.createdAt },
          create: {
            roomId: room.id,
            userId: userContext.userId,
            lastReadAt: message.createdAt,
          },
        });
        if (parentMessageId) {
          await markChatRoomThreadRead(
            room.id,
            userContext.userId,
            parentMessageId,
            tx,
            message.createdAt,
          );
        }

        return {
          message,
          mentionIds: message.mentionsAsSource.map((mention) => mention.id),
          mentionedUserIds,
          room: {
            id: room.id,
            name: room.name,
            organizationId: room.organizationId,
            kind: room.kind,
            memberUserIds: room.userMembers.map((member) => member.userId),
          },
          didCreate: true,
        };
      });
    } catch (error) {
      if (!clientId || !isPrismaUniqueViolation(error)) {
        throw error;
      }
      // Interactive tx aborted after failed create — re-read on root client.
      const raced = await prisma.chatRoomMessage.findUnique({
        where: {
          roomId_clientMessageId: {
            roomId: id,
            clientMessageId: clientId,
          },
        },
        include: chatRoomMessageInclude,
      });
      if (!raced) {
        throw error;
      }
      if (raced.senderUserId !== userContext.userId) {
        throw conflict(
          "clientMessageId already used by another sender in this room",
        );
      }
      await publishChatRoomMessageRealtime(raced, "create");

      return created(
        c,
        chatRoomMessageSchema.parse(
          mapChatRoomMessage(raced, userContext.userId),
        ),
      );
    }

    const { message, mentionIds, mentionedUserIds, room, didCreate } =
      persisted;

    if (didCreate) {
      for (const mentionId of mentionIds) {
        waitUntil(dispatchChatRoomMention(mentionId));
      }

      if (mentionedUserIds.length > 0) {
        waitUntil(
          emitChatMentionNotifications({
            roomId: room.id,
            roomName: room.name,
            organizationId: room.organizationId,
            messageId: message.id,
            authorUserId: userContext.userId,
            authorName: message.senderUser?.name ?? "Someone",
            mentionedUserIds,
          }),
        );
      }

      if (
        shouldEmitChatDirectMessageNotifications({
          kind: room.kind,
          memberUserIds: room.memberUserIds,
        })
      ) {
        const mentionedUserIdSet = new Set(mentionedUserIds);
        const recipientUserIds = room.memberUserIds.filter(
          (userId) =>
            userId !== userContext.userId && !mentionedUserIdSet.has(userId),
        );
        if (recipientUserIds.length > 0) {
          waitUntil(
            emitChatDirectMessageNotifications({
              roomId: room.id,
              roomName: room.name,
              organizationId: room.organizationId,
              messageId: message.id,
              authorUserId: userContext.userId,
              authorName: message.senderUser?.name ?? "Someone",
              recipientUserIds,
            }),
          );
        }
      }

      waitUntil(
        emitChatRoomMessageNotifications({
          roomId: room.id,
          roomName: room.name,
          roomKind: room.kind,
          organizationId: room.organizationId,
          messageId: message.id,
          authorUserId: userContext.userId,
          authorName: message.senderUser?.name ?? "Someone",
          // Read inside the write transaction, so the roster is the one the
          // message was posted against.
          memberUserIds: room.memberUserIds,
          mentionedUserIds,
        }),
      );

      waitUntil(scheduleChatRoomMessageUnfurls(message.id));
    }

    await publishChatRoomMessageRealtime(message, "create");

    return created(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(message, userContext.userId),
      ),
    );
  });
}
