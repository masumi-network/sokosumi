import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { CHAT_CATCH_UP_BUCKETS } from "@/lib/chat-signals/derive";
import {
  chatRoomMessageSchema,
  chatSignalTagSchema,
} from "@/schemas/chat-room.schema";

export const chatCatchUpBucketSchema = z
  .enum(CHAT_CATCH_UP_BUCKETS)
  .openapi("ChatCatchUpBucket", {
    description:
      "The one bucket an unread message counts in, the most pressing first: `needsYou` (a question or decision addressed to the viewer) outranks every tag.",
  });

export const chatRoomCatchUpSchema = z
  .object({
    unreadCount: z.number().int().min(0).openapi({
      description: "Unread top-level messages from others, tagged or not.",
    }),
    taggedCount: z.number().int().min(0).openapi({
      description:
        "How many of those Jev has read; the rest are too short or still waiting.",
    }),
    buckets: z.array(
      z.object({
        bucket: chatCatchUpBucketSchema,
        count: z.number().int().min(1),
        messageIds: z.array(z.string().uuid()).openapi({
          description: "Oldest first, so a jump lands on the first one.",
        }),
      }),
    ),
  })
  .openapi("ChatRoomCatchUp");

const chatSignalRoomSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(["channel", "direct"]),
});

export const chatSignalListItemSchema = z
  .object({
    kind: z.enum(["needsYou", "question", "decision", "commitment"]).openapi({
      description:
        "`needsYou`: unread and asks the viewer something. Open loops: `question` / `decision` asked of the viewer and unanswered for a few hours, `commitment` the viewer made whose date passed.",
    }),
    room: chatSignalRoomSchema,
    message: chatRoomMessageSchema,
    dueAt: dateTimeSchema.nullable(),
  })
  .openapi("ChatSignalListItem");

export const chatCatchUpItemSchema = z
  .object({
    messageId: z.string().uuid(),
    roomId: z.string().uuid(),
    roomName: z.string(),
    roomKind: z.enum(["channel", "direct"]),
    parentMessageId: z.string().uuid().nullable(),
    senderName: z.string(),
    senderImageUrl: z.string().nullable(),
    excerpt: z.string(),
    bucket: chatCatchUpBucketSchema,
    createdAt: dateTimeSchema,
    dueAt: dateTimeSchema.nullable(),
    inReplyTo: z
      .object({ senderName: z.string(), excerpt: z.string() })
      .nullable()
      .openapi({
        description:
          "For a decision: the earlier message it answers, so a bare reply reads on its own.",
      }),
  })
  .openapi("ChatCatchUpItem");

export const chatCatchUpTopicSchema = z
  .object({
    id: z.string().uuid().openapi({ description: "Its oldest message's id." }),
    title: z.string(),
    summary: z.string(),
    status: z.enum(["waitingOnYou", "decided", "inProgress", "fyi"]),
    roomId: z.string().uuid(),
    roomName: z.string(),
    roomKind: z.enum(["channel", "direct"]),
    people: z.array(
      z.object({ name: z.string(), imageUrl: z.string().nullable() }),
    ),
    latestAt: dateTimeSchema,
    messages: z.array(chatCatchUpItemSchema).openapi({
      description: "The unread messages behind it, oldest first.",
    }),
  })
  .openapi("ChatCatchUpTopic");

export const chatCatchUpSummarySchema = z
  .object({
    scope: z.string().openapi({ description: "`all` or the room id." }),
    unreadTaggedCount: z.number().int().min(0),
    unreadMessageCount: z.number().int().min(0).openapi({
      description: "Every unread message, tagged or not, in the rooms covered.",
    }),
    unreadRoomCount: z.number().int().min(0),
    awaySince: dateTimeSchema.nullable().openapi({
      description:
        "The earliest the viewer last read a room that now has unread messages.",
    }),
    counts: z.array(
      z.object({
        bucket: chatCatchUpBucketSchema,
        count: z.number().int().min(1),
      }),
    ),
    headline: z.string().nullable().openapi({
      description:
        "A short written summary, cached until a tagged message arrives that it has not read. Null when nothing is unread or the model was unavailable.",
    }),
    topics: z.array(chatCatchUpTopicSchema).openapi({
      description:
        "What happened, one subject per topic, written by the model over the unread messages; what waits on the viewer first. Without the model, each message that needs the viewer, blocks, decides or announces is a topic of its own.",
    }),
    quietRooms: z
      .array(
        z.object({
          roomId: z.string().uuid(),
          roomName: z.string(),
          unreadCount: z.number().int().min(1),
        }),
      )
      .openapi({
        description: "Rooms with unread messages and no topic in them.",
      }),
    generatedAt: dateTimeSchema.nullable(),
    needsYou: z.array(chatCatchUpItemSchema),
    blockers: z.array(chatCatchUpItemSchema).openapi({
      description: "Escalations, urgent messages and blockers.",
    }),
    decisions: z.array(chatCatchUpItemSchema),
    announcements: z.array(chatCatchUpItemSchema),
    openLoops: z.array(chatCatchUpItemSchema).openapi({
      description:
        "Questions to the viewer still unanswered and their overdue promises, the longest overdue first.",
    }),
    highlights: z.array(chatCatchUpItemSchema).openapi({
      description:
        "At most three other messages worth knowing: decisions to make, commitments, work requests, questions.",
    }),
  })
  .openapi("ChatCatchUpSummary");

export const chatSignalCorrectionRequestSchema = z
  .object({
    tag: chatSignalTagSchema,
    applies: z.boolean().openapi({
      description:
        "Whether the tag applies to the message, as the reader sees it.",
    }),
  })
  .openapi("ChatSignalCorrectionRequest");

export const chatSignalLoopRequestSchema = z
  .object({
    closed: z.boolean().openapi({
      description: "True closes the open loop; false reopens it.",
    }),
    taskId: z.string().uuid().nullable().optional().openapi({
      description: "The Task the loop was made into, when closing it so.",
    }),
  })
  .openapi("ChatSignalLoopRequest");

export const chatSignalRoutingSuggestionSchema = z
  .object({
    coworkerId: z.string(),
    name: z.string(),
    caption: z.string().nullable(),
    fit: z.number().min(0).max(1).openapi({
      description: "Jev's probability that this Coworker can do the request.",
    }),
  })
  .openapi("ChatSignalRoutingSuggestion");
