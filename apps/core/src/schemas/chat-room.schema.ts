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

/**
 * Non-null channel discoverability. Never chain `.nullable()` onto this named
 * schema — that poisons the OpenAPI component with `null` and loosens every
 * consumer type (including discoverable list rows).
 */
export const chatRoomDiscoverabilitySchema = z
  .enum(["public", "private", "external"])
  .openapi("ChatRoomDiscoverability", {
    description:
      'Channel discoverability: `"public"` (org-discoverable and self-joinable by any member), `"private"` (roster-only for plain members; organization owners/admins can still browse and self-join), or `"external"` (org-discoverable / self-joinable for host members; outsiders join only via room invitation as guests).',
    example: "public",
  });

/**
 * Discoverable-list row discoverability. Always non-null.
 * Private rows only appear for organization owners/admins; external rows
 * appear for every org member (same as public).
 */
export const discoverableChannelDiscoverabilitySchema = z
  .enum(["public", "private", "external"])
  .openapi("DiscoverableChannelDiscoverability", {
    description:
      '`"public"` and `"external"` for every org member; `"private"` only for organization owners and admins.',
    example: "public",
  });

/** Room membership access values (Prisma column + OpenAPI enum). */
export const CHAT_ROOM_ACCESS = {
  MEMBER: "member",
  GUEST: "guest",
} as const;

export const chatRoomAccessSchema = z
  .enum([CHAT_ROOM_ACCESS.MEMBER, CHAT_ROOM_ACCESS.GUEST])
  .openapi("ChatRoomAccess");

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
    /**
     * Guests on external channels are `"guest"`. Hosts and directs use
     * `"member"`. Optional for older payloads; Core always emits it.
     */
    access: chatRoomAccessSchema.optional().openapi({
      description:
        'Room membership kind: `"member"` (host-org participant) or `"guest"` (external channel only).',
      example: "member",
    }),
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
        "Organization that owns the room. Null for Personal Directs (human 1:1 from an External channel, and coworker 1:1 created with no active organization).",
      example: "org_123",
    }),
    organizationName: z.string().nullable().openapi({
      description:
        "Host organization display name. Required for guest rows in list; may be null for personal directs.",
      example: "Acme Corp",
    }),
    name: z.string().openapi({ example: "Launch Room" }),
    slug: z.string().nullable().openapi({
      description:
        "Channel slug unique among Channels in the organization. Null for Directs.",
      example: "launch-room",
    }),
    kind: z.enum(["channel", "direct"]).openapi({ example: "channel" }),
    directKey: z.string().nullable().openapi({
      description: "Deterministic key for direct rooms; null for normal rooms.",
      example: "user_123:user_456",
    }),
    topic: z.string().nullable().openapi({ example: "Weekly launch planning" }),
    // Inline nullable enum — do not use chatRoomDiscoverabilitySchema.nullable()
    // or the shared ChatRoomDiscoverability component gains null.
    discoverability: z
      .enum(["public", "private", "external"])
      .nullable()
      .openapi({
        description:
          'Channel discoverability: `"public"` (org-discoverable and self-joinable by any member), `"private"` (roster-only for plain members; organization owners/admins can still browse and self-join), or `"external"` (org-discoverable / self-joinable for host members; outsiders join only via room invitation as guests). Null for direct rooms.',
        example: "public",
      }),
    createdByUserId: z.string().openapi({ example: "user_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    unreadCount: z.number().int().min(0).openapi({
      description:
        "Unread messages from others: top-level after room lastReadAt, plus thread replies in Threads the viewer Participates in after per-thread look baseline (thread lastReadAt, else room join createdAt). Soft-deleted excluded. ADR-0013.",
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
    myAccess: chatRoomAccessSchema.openapi({
      description:
        "Caller's membership on this room. Guests are not host-org members.",
      example: "member",
    }),
    peerInActiveOrganization: z.boolean().default(false).openapi({
      description:
        "True when every other human on a Direct is a Member of the caller's active organization. False with no active organization.",
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

export const channelSlugAvailabilitySchema = z
  .object({
    status: z.enum(["free", "taken"]).openapi({
      description:
        "Whether the sanitized Channel slug is free among Channels in the active organization, including private and archived Channels. Does not identify the occupant.",
      example: "free",
    }),
  })
  .openapi("ChannelSlugAvailability");

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
          "Creates a named org channel. memberUserIds/coworkerIds seed the initial roster; they do not limit discoverability. Public and external channels are org-discoverable and self-joinable by any member (GET /chats/rooms/discoverable, POST /chats/rooms/{id}/members/me). Private channels stay roster-only for plain members; organization owners and admins can still browse and self-join them. External channels also allow guest invites (owner/admin create only).",
      }),
      name: z.string().trim().min(1).max(80).openapi({
        example: "Launch Room",
      }),
      slug: z.string().optional().openapi({
        description:
          "Required Channel slug. Core sanitizes with kebab rules and rejects missing or empty-after-sanitize values. Unique among Channels in the organization.",
        example: "launch-room",
      }),
      topic: z.string().trim().max(200).optional().openapi({
        example: "Launch planning with design and AI research partners",
      }),
      discoverability: chatRoomDiscoverabilitySchema
        .default("public")
        .optional()
        .openapi({
          description:
            'Channel discoverability. Defaults to `"public"` (org-discoverable / joinable by any member). `"private"` keeps the channel roster-only for plain members; organization owners and admins can still browse and self-join. `"external"` is org-discoverable for host members; guests join only via room invitation (owner/admin create only).',
          example: "public",
        }),
      memberUserIds: roomMemberUserIdsSchema,
      coworkerIds: roomCoworkerIdsSchema,
    }),
    z
      .object({
        kind: z.literal("direct").openapi({
          description:
            "Creates or returns a direct room: one or more humans (1:1 or multi-human group), or exactly one coworker. Human and coworker targets cannot be mixed. Human 1:1 is an Org Direct when both are Members of the active organization; otherwise a Personal Direct when they share an External channel. Multi-human groups and coworker DMs with an active org are org-scoped. Coworker DMs may be personal with no active org. Coworker API keys may create-or-get an org-scoped coworker 1:1 with memberUserIds: [target] and no coworkerIds (the actor is the coworker). Discoverability is not allowed on directs.",
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
    slug: z.string().optional().openapi({
      description: "Rejected. Channel slug is immutable after create.",
      example: "launch-room",
    }),
    topic: z.string().trim().max(200).nullable().optional().openapi({
      example: "Launch planning with design and AI research partners",
    }),
    discoverability: chatRoomDiscoverabilitySchema.optional().openapi({
      description:
        'Update channel discoverability. `"public"` makes the channel org-discoverable and self-joinable by any member; `"private"` hides it from the discoverable listing for plain members (organization owners/admins still see and can join it); `"external"` is org-discoverable for host members with guest invites. Converting away from `"external"` is blocked while guest members or pending invites exist.',
      example: "private",
    }),
    memberUserIds: z
      .array(z.string().min(1))
      .max(MAX_ROOM_MEMBERS)
      .optional()
      .openapi({
        description:
          "Host-org roster rewrite. Existing guest members are room-scoped and survive this field: ids already `access=guest` on the room are ignored (not 400) unless they are now organization members, in which case they upgrade to `access=member`. Omit a guest to keep them. Do not use this field to add or remove guests.",
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
    discoverability: discoverableChannelDiscoverabilitySchema,
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

export const chatRoomMessageMembershipSubjectSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("user"),
      id: z.string(),
      name: z.string(),
    }),
    z.object({
      type: z.literal("coworker"),
      id: z.string(),
      name: z.string(),
    }),
  ])
  .openapi("ChatRoomMessageMembershipSubject");

/** Durable channel join/leave snapshot under metadata.membership, promoted on the DTO. */
export const chatRoomMessageMembershipSchema = z
  .object({
    action: z.enum(["joined", "left"]),
    subject: chatRoomMessageMembershipSubjectSchema,
  })
  .openapi("ChatRoomMessageMembership");

/** One successful page preview stored under metadata.unfurls and promoted on the DTO. */
export const chatRoomMessageUnfurlSchema = z
  .object({
    url: z.string().url().openapi({ example: "https://example.com/article" }),
    title: z.string().min(1).openapi({ example: "Example Article" }),
    description: z
      .string()
      .nullable()
      .openapi({ example: "A short summary of the page." }),
    imageUrl: z
      .string()
      .url()
      .nullable()
      .openapi({ example: "https://cdn.example.com/og.png" }),
    siteName: z.string().nullable().openapi({ example: "Example" }),
  })
  .openapi("ChatRoomMessageUnfurl");

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
    membership: chatRoomMessageMembershipSchema.nullable(),
    unfurls: z.array(chatRoomMessageUnfurlSchema).max(3).nullable().openapi({
      description:
        "Link preview cards scraped from message URLs (absent while pending).",
    }),
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
        "Human members left in the room after the caller leaves. Always at least one: the final member cannot leave; an organization owner/admin must archive instead.",
      example: 3,
    }),
  })
  .openapi("LeftChatRoom");

/**
 * Restore clears archivedAt and returns the live room again. Full ChatRoom
 * shape so the client can navigate without a second fetch.
 */
export const restoredChatRoomSchema = chatRoomSchema;

/**
 * A top-level room message that has ≥1 non-deleted reply, with per-user look
 * metadata. `unreadReplyCount` is Participant-gated (ADR-0013): never-looked
 * Participants can be > 0; lurkers are 0. Same set as room unread's thread
 * slice, `unread=true`, and Mark all.
 */
export const chatRoomThreadSchema = z
  .object({
    parentMessage: chatRoomMessageSchema,
    replyCount: z.number().int().min(1).openapi({
      description: "Non-deleted replies under this parent.",
      example: 5,
    }),
    lastReplyAt: dateTimeSchema.openapi({
      description: "createdAt of the newest non-deleted reply.",
      example: "2026-07-02T12:00:00.000Z",
    }),
    unreadReplyCount: z.number().int().min(0).openapi({
      description:
        "Non-deleted replies from others after the dual-baseline look, only when the viewer is a Participant (parent author, remaining reply, or remaining user mention). Zero for lurkers, including never-looked lurkers.",
      example: 2,
    }),
    lastUnreadReplyAt: dateTimeSchema.nullable().openapi({
      description:
        "createdAt of the newest qualifying unread reply, or null when none.",
      example: "2026-07-02T12:00:00.000Z",
    }),
    hasLooked: z.boolean().openapi({
      description:
        "True when the viewer has a ChatRoomThreadReadState row for this parent. Never-looked threads are false even when replyCount > 0.",
      example: true,
    }),
  })
  .openapi("ChatRoomThread");

/** Result of marking a thread parent as looked (ThreadPanel open). */
export const chatRoomThreadReadStateSchema = z
  .object({
    parentMessageId: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    lastReadAt: dateTimeSchema,
  })
  .openapi("ChatRoomThreadReadState");

/** Result of marking every unread thread in a room as looked. */
export const chatRoomThreadsMarkAllSchema = z
  .object({
    markedCount: z.number().int().min(0).openapi({
      description: "Number of parent threads whose look state was upserted.",
      example: 3,
    }),
  })
  .openapi("ChatRoomThreadsMarkAll");

/** Cheap unread-thread count. Same Participant-gated set as `unread=true`. */
export const chatRoomThreadsUnreadCountSchema = z
  .object({
    count: z.number().int().min(0).openapi({
      description:
        "Number of unread threads (`unreadReplyCount >= 1`, Participant-gated dual-baseline). Does not hydrate thread items.",
      example: 4,
    }),
  })
  .openapi("ChatRoomThreadsUnreadCount");

export type ChatRoom = z.infer<typeof chatRoomSchema>;
export type DiscoverableChatRoom = z.infer<typeof discoverableChatRoomSchema>;
export type ChatRoomMessage = z.infer<typeof chatRoomMessageSchema>;
export type ChatRoomMessageQuote = z.infer<typeof chatRoomMessageQuoteSchema>;
export type ChatRoomMessageUnfurl = z.infer<typeof chatRoomMessageUnfurlSchema>;
export type ChatRoomMessageMembership = z.infer<
  typeof chatRoomMessageMembershipSchema
>;
export type ChatRoomThread = z.infer<typeof chatRoomThreadSchema>;
export type ChatRoomThreadReadState = z.infer<
  typeof chatRoomThreadReadStateSchema
>;
export type ChatRoomThreadsMarkAll = z.infer<
  typeof chatRoomThreadsMarkAllSchema
>;
export type ChatRoomThreadsUnreadCount = z.infer<
  typeof chatRoomThreadsUnreadCountSchema
>;
