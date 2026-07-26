import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const chatChannelPresenceSchema = z
  .enum(["online", "afk", "offline"])
  .openapi("ChatChannelPresence");

export const chatChannelUserParticipantSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Jane Doe" }),
    email: z.string().openapi({ example: "jane@example.com" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/avatar.png" }),
    presence: chatChannelPresenceSchema.openapi({ example: "online" }),
  })
  .openapi("ChatChannelUserParticipant");

export const chatChannelCoworkerParticipantSchema = z
  .object({
    id: z.string().openapi({ example: "cow_123" }),
    name: z.string().openapi({ example: "Elena" }),
    slug: z.string().openapi({ example: "elena" }),
    caption: z.string().nullable().openapi({ example: "Research partner" }),
    image: z
      .string()
      .nullable()
      .openapi({ example: "https://example.com/coworker.png" }),
    presence: chatChannelPresenceSchema.openapi({ example: "online" }),
  })
  .openapi("ChatChannelCoworkerParticipant");

export const chatChannelSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "Channel ID",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    organizationId: z.string().openapi({ example: "org_123" }),
    name: z.string().openapi({ example: "Launch Room" }),
    slug: z.string().openapi({ example: "launch-room" }),
    kind: z.enum(["channel", "direct"]).openapi({ example: "channel" }),
    directKey: z.string().nullable().openapi({
      description:
        "Deterministic key for direct channels; null for normal channels.",
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
    userMembers: z.array(chatChannelUserParticipantSchema),
    coworkerMembers: z.array(chatChannelCoworkerParticipantSchema),
  })
  .openapi("ChatChannel");

export const createChatChannelRequestSchema = z
  .object({
    organizationId: z.string().min(1).openapi({ example: "org_123" }),
    name: z.string().trim().min(1).max(80).openapi({
      example: "Launch Room",
    }),
    topic: z.string().trim().max(200).optional().openapi({
      example: "Launch planning with design and AI research partners",
    }),
    memberUserIds: z
      .array(z.string().min(1))
      .optional()
      .openapi({
        example: ["user_123", "user_456"],
      }),
    coworkerIds: z
      .array(z.string().min(1))
      .optional()
      .openapi({
        example: ["cow_123"],
      }),
  })
  .openapi("CreateChatChannelRequest");

export const createDirectChatChannelRequestSchema = z
  .object({
    organizationId: z.string().min(1).openapi({ example: "org_123" }),
    memberUserId: z.string().min(1).optional().openapi({
      description:
        "Deprecated one-to-one organization member user ID. Use memberUserIds for new clients.",
      example: "user_456",
    }),
    coworkerId: z.string().min(1).optional().openapi({
      description:
        "Deprecated one-to-one AI coworker ID. Use coworkerIds for new clients.",
      example: "cow_123",
    }),
    memberUserIds: z
      .array(z.string().min(1))
      .optional()
      .openapi({
        description:
          "Organization member user IDs to include in the direct message.",
        example: ["user_456", "user_789"],
      }),
    coworkerIds: z
      .array(z.string().min(1))
      .optional()
      .openapi({
        description: "AI coworker IDs to include in the direct message.",
        example: ["cow_123"],
      }),
  })
  .refine(
    (value) =>
      [
        value.memberUserId,
        value.coworkerId,
        ...(value.memberUserIds ?? []),
        ...(value.coworkerIds ?? []),
      ].filter(Boolean).length > 0,
    {
      message: "Choose at least one direct message target",
      path: ["memberUserIds"],
    },
  )
  .openapi("CreateDirectChatChannelRequest");

export const updateChatChannelRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional().openapi({
      example: "Launch Room",
    }),
    topic: z.string().trim().max(200).nullable().optional().openapi({
      example: "Launch planning with design and AI research partners",
    }),
    memberUserIds: z
      .array(z.string().min(1))
      .optional()
      .openapi({
        example: ["user_123", "user_456"],
      }),
    coworkerIds: z
      .array(z.string().min(1))
      .optional()
      .openapi({
        example: ["cow_123"],
      }),
  })
  .openapi("UpdateChatChannelRequest");

export const chatChannelMentionStatusSchema = z
  .enum(["pending", "sent", "responded", "failed"])
  .openapi("ChatChannelMentionStatus");

export const chatChannelMessageMentionSchema = z
  .object({
    id: z.string().uuid(),
    coworkerId: z.string(),
    status: chatChannelMentionStatusSchema,
    responseMessageId: z.string().uuid().nullable(),
  })
  .openapi("ChatChannelMessageMention");

export const chatChannelMessageSenderSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("user"),
      user: chatChannelUserParticipantSchema,
    }),
    z.object({
      type: z.literal("coworker"),
      coworker: chatChannelCoworkerParticipantSchema,
    }),
    z.object({
      type: z.literal("unknown"),
    }),
  ])
  .openapi("ChatChannelMessageSender");

export const chatChannelMessageReactionSchema = z
  .object({
    emoji: z.string().min(1).max(24).openapi({ example: "👍" }),
    count: z.number().int().min(0).openapi({ example: 3 }),
    reactedByCurrentUser: z.boolean().openapi({ example: true }),
  })
  .openapi("ChatChannelMessageReaction");

export const chatChannelMessageSchema = z
  .object({
    id: z.string().uuid(),
    channelId: z.string().uuid(),
    parentMessageId: z.string().uuid().nullable(),
    content: z.string(),
    createdAt: dateTimeSchema,
    sender: chatChannelMessageSenderSchema,
    mentions: z.array(chatChannelMessageMentionSchema),
    reactions: z.array(chatChannelMessageReactionSchema),
    threadReplyCount: z.number().int().min(0),
    threadLastReplyAt: dateTimeSchema.nullable(),
    metadata: z.record(z.string(), z.any()).nullable(),
  })
  .openapi("ChatChannelMessage");

export const createChatChannelMessageRequestSchema = z
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
  .openapi("CreateChatChannelMessageRequest");

export const reactToChatChannelMessageRequestSchema = z
  .object({
    emoji: z.string().trim().min(1).max(24).openapi({ example: "👍" }),
  })
  .openapi("ReactToChatChannelMessageRequest");

export type ChatChannel = z.infer<typeof chatChannelSchema>;
export type ChatChannelMessage = z.infer<typeof chatChannelMessageSchema>;
