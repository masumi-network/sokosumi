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

export const chatRoomDiscoverabilitySchema = z
  .enum(["public", "private"])
  .openapi("ChatRoomDiscoverability");

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
    organizationId: z.string().nullable().openapi({
      description:
        "Active organization at create time for channels and directs. Null only for coworker 1:1 DMs created with no active organization.",
      example: "org_123",
    }),
    name: z.string().openapi({ example: "Launch Room" }),
    slug: z.string().openapi({ example: "launch-room" }),
    kind: z.enum(["channel", "direct"]).openapi({ example: "channel" }),
    directKey: z.string().nullable().openapi({
      description: "Deterministic key for direct rooms; null for normal rooms.",
      example: "user_123:user_456",
    }),
    topic: z.string().nullable().openapi({ example: "Weekly launch planning" }),
    discoverability: chatRoomDiscoverabilitySchema.nullable().openapi({
      description:
        'Channel discoverability: `"public"` (org-discoverable and self-joinable) or `"private"` (roster-only). Null for direct rooms.',
      example: "public",
    }),
    createdByUserId: z.string().openapi({ example: "user_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    unreadCount: z.number().int().min(0).openapi({
      description:
        "Messages sent by others after the current user's read marker.",
      example: 2,
    }),
    unreadMentionCount: z.number().int().min(0).openapi({
      description:
        "Unread @mention attentions for the current user in this room (CHAT notifications with referenceId=roomId). Cleared on mark-read.",
      example: 1,
    }),
    pinnedAt: dateTimeSchema.nullable().openapi({
      description:
        "When the current user pinned this room in their sidebar. Null when unpinned.",
      example: "2026-08-02T12:00:00.000Z",
    }),
    mutedAt: dateTimeSchema.nullable().openapi({
      description:
        "When the current user muted this room. Null when unmuted. Muted rooms sort last, hide sidebar attention chrome, and skip CHAT mention notifications.",
      example: "2026-08-03T12:00:00.000Z",
    }),
    markedUnread: z.boolean().openapi({
      description:
        "True when the current user marked this room unread. Cleared on mark-read.",
      example: false,
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

export const chatRoomListStatusSchema = z
  .enum(["active", "archived"])
  .openapi("ChatRoomListStatus");

export const createChatRoomRequestSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("channel").openapi({
        description:
          "Creates a named org channel. memberUserIds/coworkerIds seed the initial roster; they do not limit discoverability. Public channels are org-discoverable and self-joinable (GET /chats/rooms/discoverable, POST /chats/rooms/{id}/members/me). Private channels stay roster-only.",
      }),
      name: z.string().trim().min(1).max(80).openapi({
        example: "Launch Room",
      }),
      topic: z.string().trim().max(200).optional().openapi({
        example: "Launch planning with design and AI research partners",
      }),
      discoverability: chatRoomDiscoverabilitySchema
        .default("public")
        .optional()
        .openapi({
          description:
            'Channel discoverability. Defaults to `"public"` (org-discoverable / joinable). `"private"` keeps the channel roster-only.',
          example: "public",
        }),
      memberUserIds: roomMemberUserIdsSchema,
      coworkerIds: roomCoworkerIdsSchema,
    }),
    z
      .object({
        kind: z.literal("direct").openapi({
          description:
            "Creates or returns a direct room: one or more organization members (1:1 or multi-human group), or exactly one coworker. Human and coworker targets cannot be mixed. Scoped to the active organization when set. Coworker DMs may be personal with no active org; human DMs require an active organization. Discoverability is not allowed on directs.",
        }),
        memberUserIds: roomMemberUserIdsSchema,
        coworkerIds: roomCoworkerIdsSchema,
      })
      .strict(),
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
    discoverability: chatRoomDiscoverabilitySchema.optional().openapi({
      description:
        'Update channel discoverability. `"public"` makes the channel org-discoverable and self-joinable; `"private"` hides it from the discoverable listing.',
      example: "private",
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

export const discoverableChatRoomSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    name: z.string().openapi({ example: "Launch Room" }),
    slug: z.string().openapi({ example: "launch-room" }),
    topic: z.string().nullable().openapi({ example: "Weekly launch planning" }),
    discoverability: z.literal("public").openapi({ example: "public" }),
    memberCount: z.number().int().min(0).openapi({ example: 12 }),
    createdByUserId: z.string().openapi({ example: "user_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("DiscoverableChatRoom");

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

/** Cap on named reactors returned per emoji; `count` may still exceed this. */
export const MAX_LISTED_CHAT_REACTION_REACTORS = 20;

export const chatRoomMessageReactorSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Jane Doe" }),
  })
  .openapi("ChatRoomMessageReactor");

export const chatRoomMessageReactionSchema = z
  .object({
    emoji: z.string().min(1).max(24).openapi({ example: "👍" }),
    count: z.number().int().min(0).openapi({ example: 3 }),
    reactedByCurrentUser: z.boolean().openapi({ example: true }),
    reactors: z
      .array(chatRoomMessageReactorSchema)
      .max(MAX_LISTED_CHAT_REACTION_REACTORS)
      .openapi({
        description:
          "First reactors by createdAt ascending (capped). count may exceed reactors.length.",
        example: [{ id: "user_123", name: "Jane Doe" }],
      }),
  })
  .openapi("ChatRoomMessageReaction");

export const chatRoomMessageQuoteAttachmentSchema = z
  .object({
    fileName: z.string().openapi({ example: "launch.png" }),
    url: z.string().openapi({ example: "https://blob.example/launch.png" }),
    mediaKind: z.enum(["image", "file"]).openapi({ example: "image" }),
  })
  .openapi("ChatRoomMessageQuoteAttachment");

/** Snapshot of a quoted room message, stored under metadata.quote and promoted on the DTO. */
export const chatRoomMessageQuoteSchema = z
  .object({
    messageId: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    authorName: z.string().openapi({ example: "Jane Doe" }),
    snippet: z.string().openapi({
      example: "Can you summarize this launch risk?",
    }),
    attachment: chatRoomMessageQuoteAttachmentSchema.nullable().optional(),
  })
  .openapi("ChatRoomMessageQuote");

export const chatRoomMessageSchema = z
  .object({
    id: z.string().uuid(),
    roomId: z.string().uuid(),
    parentMessageId: z.string().uuid().nullable(),
    content: z.string(),
    createdAt: dateTimeSchema,
    deletedAt: dateTimeSchema.nullable(),
    editedAt: dateTimeSchema.nullable(),
    sender: chatRoomMessageSenderSchema,
    mentions: z.array(chatRoomMessageMentionSchema),
    reactions: z.array(chatRoomMessageReactionSchema),
    threadReplyCount: z.number().int().min(0),
    threadLastReplyAt: dateTimeSchema.nullable(),
    metadata: z.record(z.string(), z.any()).nullable(),
    quote: chatRoomMessageQuoteSchema.nullable(),
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
    mentionedUserIds: z
      .array(z.string().min(1))
      .optional()
      .openapi({
        description:
          "Human room members addressed in the message. Validated against room membership; does not create ChatRoomMention rows or AI dispatch.",
        example: ["user_123"],
      }),
    parentMessageId: z.string().uuid().optional().openapi({
      description: "Root message ID when posting a threaded reply.",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    quote: z
      .object({
        messageId: z.string().uuid().openapi({
          example: "550e8400-e29b-41d4-a716-446655440000",
        }),
      })
      .optional()
      .openapi({
        description:
          "Quote another message in the same room. Snapshot is stored in metadata.quote; does not set parentMessageId.",
      }),
    clientMessageId: z.string().trim().min(1).max(128).optional().openapi({
      description:
        "Opaque client turn id. Retries of the same send reuse this so concurrent or replayed POSTs create at most one row per room (unique on roomId + clientMessageId).",
      example: "019fbee7-676b-771f-ab7a-998f25f1f16b",
    }),
  })
  .openapi("CreateChatRoomMessageRequest");

export const updateChatRoomMessageRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(10_000).openapi({
      example: "Fixed typo in the launch summary",
    }),
  })
  .openapi("UpdateChatRoomMessageRequest");

export const reactToChatRoomMessageRequestSchema = z
  .object({
    emoji: z.string().trim().min(1).max(24).openapi({ example: "👍" }),
  })
  .openapi("ReactToChatRoomMessageRequest");

/**
 * Archiving and leaving both make the room unreachable for the caller, so
 * echoing the whole room back would describe something they can no longer
 * read. These report only what changed.
 */
export const archivedChatRoomSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    archivedAt: dateTimeSchema,
  })
  .openapi("ArchivedChatRoom");

export const leftChatRoomSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    remainingUserMemberCount: z.number().int().min(1).openapi({
      description:
        "Human members left in the room after the caller leaves. Always at least one: the final member cannot leave; the channel creator or an organization owner/admin must archive instead.",
      example: 3,
    }),
  })
  .openapi("LeftChatRoom");

/**
 * Restore clears archivedAt and returns the live room again. Full ChatRoom
 * shape so the client can navigate without a second fetch.
 */
export const restoredChatRoomSchema = chatRoomSchema;

export type ChatRoom = z.infer<typeof chatRoomSchema>;
export type DiscoverableChatRoom = z.infer<typeof discoverableChatRoomSchema>;
export type ChatRoomMessage = z.infer<typeof chatRoomMessageSchema>;
export type ChatRoomMessageQuote = z.infer<typeof chatRoomMessageQuoteSchema>;
