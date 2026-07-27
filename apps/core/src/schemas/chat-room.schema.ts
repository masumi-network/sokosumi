import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/**
 * Roster writes fan out to one row per id, so an unbounded array turns a
 * single request into an arbitrarily long transaction. These caps are far
 * above any real room and keep that bounded.
 */
const MAX_ROOM_MEMBERS = 500;
const MAX_ROOM_COWORKERS = 50;

export const chatRoomPresenceSchema = z
  .enum(["online", "afk", "offline"])
  .openapi("ChatRoomPresence");

export const chatRoomUserParticipantSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Jane Doe" }),
    email: z.string().openapi({ example: "jane@example.com" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/avatar.png" }),
    presence: chatRoomPresenceSchema.openapi({ example: "online" }),
  })
  .openapi("ChatRoomUserParticipant");

export const chatRoomCoworkerParticipantSchema = z
  .object({
    id: z.string().openapi({ example: "cow_123" }),
    name: z.string().openapi({ example: "Elena" }),
    slug: z.string().openapi({ example: "elena" }),
    caption: z.string().nullable().openapi({ example: "Research partner" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/coworker.png" }),
    presence: chatRoomPresenceSchema.openapi({ example: "online" }),
  })
  .openapi("ChatRoomCoworkerParticipant");

export const chatRoomSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Room ID",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    organizationId: z.string().openapi({ example: "org_123" }),
    name: z.string().openapi({ example: "Launch Room" }),
    slug: z.string().openapi({ example: "launch-room" }),
    kind: z.enum(["channel", "direct"]).openapi({ example: "channel" }),
    directKey: z.string().nullable().openapi({
      description: "Deterministic key for direct rooms; null for normal rooms.",
      example: "user_123:user_456",
    }),
    topic: z.string().nullable().openapi({ example: "Weekly launch planning" }),
    createdByUserId: z.string().openapi({ example: "user_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    unreadCount: z.number().int().min(0).openapi({
      description:
        "Messages sent by others after the current user's read marker.",
      example: 2,
    }),
    userMembers: z.array(chatRoomUserParticipantSchema),
    coworkerMembers: z.array(chatRoomCoworkerParticipantSchema),
  })
  .openapi("ChatRoom");

const roomMemberUserIdsSchema = z
  .array(z.string().min(1))
  .max(MAX_ROOM_MEMBERS)
  .optional()
  .openapi({
    description: "Organization member user IDs to add to the room.",
    example: ["user_123", "user_456"],
  });

const roomCoworkerIdsSchema = z
  .array(z.string().min(1))
  .max(MAX_ROOM_COWORKERS)
  .optional()
  .openapi({
    description: "AI coworker IDs to add to the room.",
    example: ["cow_123"],
  });

export const chatRoomKindSchema = z
  .enum(["channel", "direct"])
  .openapi("ChatRoomKind");

export const createChatRoomRequestSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("channel").openapi({
        description:
          "Creates a named room for the invited members and coworkers (membership is explicit, not org-wide).",
      }),
      name: z.string().trim().min(1).max(80).openapi({
        example: "Launch Room",
      }),
      topic: z.string().trim().max(200).optional().openapi({
        example: "Launch planning with design and AI research partners",
      }),
      memberUserIds: roomMemberUserIdsSchema,
      coworkerIds: roomCoworkerIdsSchema,
    }),
    z.object({
      kind: z.literal("direct").openapi({
        description:
          "Creates or returns the direct room for this participant set. The name is derived from the participants; the caller is always a participant.",
      }),
      memberUserIds: roomMemberUserIdsSchema,
      coworkerIds: roomCoworkerIdsSchema,
    }),
  ])
  .openapi("CreateChatRoomRequest");

export const updateChatRoomRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional().openapi({
      example: "Launch Room",
    }),
    topic: z.string().trim().max(200).nullable().optional().openapi({
      example: "Launch planning with design and AI research partners",
    }),
    memberUserIds: z
      .array(z.string().min(1))
      .max(MAX_ROOM_MEMBERS)
      .optional()
      .openapi({
        example: ["user_123", "user_456"],
      }),
    coworkerIds: z
      .array(z.string().min(1))
      .max(MAX_ROOM_COWORKERS)
      .optional()
      .openapi({
        example: ["cow_123"],
      }),
  })
  .openapi("UpdateChatRoomRequest");

export const chatRoomMentionStatusSchema = z
  .enum(["pending", "sent", "responded", "failed"])
  .openapi("ChatRoomMentionStatus");

export const chatRoomMessageMentionSchema = z
  .object({
    id: z.string().uuid(),
    coworkerId: z.string(),
    status: chatRoomMentionStatusSchema,
    responseMessageId: z.string().uuid().nullable(),
  })
  .openapi("ChatRoomMessageMention");

export const chatRoomMessageSenderSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("user"),
      user: chatRoomUserParticipantSchema,
    }),
    z.object({
      type: z.literal("coworker"),
      coworker: chatRoomCoworkerParticipantSchema,
    }),
    z.object({
      type: z.literal("unknown"),
    }),
  ])
  .openapi("ChatRoomMessageSender");

export const chatRoomMessageReactionSchema = z
  .object({
    emoji: z.string().min(1).max(24).openapi({ example: "👍" }),
    count: z.number().int().min(0).openapi({ example: 3 }),
    reactedByCurrentUser: z.boolean().openapi({ example: true }),
  })
  .openapi("ChatRoomMessageReaction");

export const chatRoomMessageSchema = z
  .object({
    id: z.string().uuid(),
    roomId: z.string().uuid(),
    parentMessageId: z.string().uuid().nullable(),
    content: z.string(),
    createdAt: dateTimeSchema,
    sender: chatRoomMessageSenderSchema,
    mentions: z.array(chatRoomMessageMentionSchema),
    reactions: z.array(chatRoomMessageReactionSchema),
    threadReplyCount: z.number().int().min(0),
    threadLastReplyAt: dateTimeSchema.nullable(),
    metadata: z.record(z.string(), z.any()).nullable(),
  })
  .openapi("ChatRoomMessage");

export const createChatRoomMessageRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(10_000).openapi({
      example: "@coworker:elena Can you summarize this launch risk?",
    }),
    mentionedCoworkerIds: z
      .array(z.string().min(1))
      .optional()
      .openapi({
        example: ["cow_123"],
      }),
    parentMessageId: z.string().uuid().optional().openapi({
      description: "Root message ID when posting a threaded reply.",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  })
  .openapi("CreateChatRoomMessageRequest");

export const reactToChatRoomMessageRequestSchema = z
  .object({
    emoji: z.string().trim().min(1).max(24).openapi({ example: "👍" }),
  })
  .openapi("ReactToChatRoomMessageRequest");

export type ChatRoom = z.infer<typeof chatRoomSchema>;
export type ChatRoomMessage = z.infer<typeof chatRoomMessageSchema>;
