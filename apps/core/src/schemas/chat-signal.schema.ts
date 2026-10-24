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
    excerpt: z.string(),
    bucket: chatCatchUpBucketSchema,
    createdAt: dateTimeSchema,
    dueAt: dateTimeSchema.nullable(),
  })
  .openapi("ChatCatchUpItem");

export const chatCatchUpSummarySchema = z
  .object({
    scope: z.string().openapi({ description: "`all` or the room id." }),
    unreadTaggedCount: z.number().int().min(0),
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
    rooms: z.array(
      z.object({
        roomId: z.string().uuid(),
        roomName: z.string(),
        line: z.string(),
      }),
    ),
    generatedAt: dateTimeSchema.nullable(),
    needsYou: z.array(chatCatchUpItemSchema),
    decisions: z.array(chatCatchUpItemSchema),
    openLoops: z.array(chatCatchUpItemSchema),
    highlights: z.array(chatCatchUpItemSchema),
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
