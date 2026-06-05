import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";

import { dateTimeSchema } from "@/helpers/datetime";

const historyBaseItemSchema = z.object({
  id: z.string().openapi({
    description: "Source entity ID for this history row",
    example: "cmi4gmksz000104l8wps8p7fp",
  }),
  title: z.string().openapi({
    description: "Display title for the history row",
    example: "Review onboarding flow",
  }),
  description: z.string().nullable().openapi({
    description: "Short subtitle or description for the history row",
    example: "Audit copy and empty states",
  }),
  updatedAt: dateTimeSchema.openapi({
    description: "Source entity updatedAt timestamp used for feed ordering",
  }),
  archivedAt: dateTimeSchema.nullable().openapi({
    description:
      "Source entity archivedAt timestamp. Null means the row is navigable.",
  }),
  credits: z.number().nullable().openapi({
    description:
      "User-facing credits. Null means credits do not apply to this item.",
    example: 2.5,
  }),
});

export const historyTaskItemSchema = historyBaseItemSchema
  .extend({
    kind: z.literal("task"),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.RUNNING }),
    projectId: z.string().uuid().nullable().openapi({
      description: "Project ID for the task, when assigned",
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    coworkerId: z.string().nullable().openapi({
      description: "Coworker ID associated with the task, when assigned",
      example: "cow_123",
    }),
  })
  .openapi("HistoryTaskItem");

export const historyJobItemSchema = historyBaseItemSchema
  .extend({
    kind: z.literal("job"),
    status: z
      .enum(SokosumiJobStatus)
      .openapi({ example: SokosumiJobStatus.COMPLETED }),
    projectId: z.string().uuid().nullable().openapi({
      description: "Project ID for the job, when assigned",
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    agentId: z.string().openapi({
      description: "Agent ID for deep-linking to the job",
      example: "agent_123",
    }),
  })
  .openapi("HistoryJobItem");

export const historyConversationItemSchema = historyBaseItemSchema
  .extend({
    kind: z.literal("conversation"),
    status: z.enum(["active", "archived"]).openapi({ example: "active" }),
    credits: z.null().openapi({
      description: "Conversations do not currently have credits",
      example: null,
    }),
    bucketSlug: z.string().nullable().openapi({
      description: "Chat bucket slug for deep-linking to the conversation",
      example: "hannah",
    }),
  })
  .openapi("HistoryConversationItem");

export const historyItemSchema = z
  .discriminatedUnion("kind", [
    historyTaskItemSchema,
    historyJobItemSchema,
    historyConversationItemSchema,
  ])
  .openapi("HistoryItem");

export const historyListSchema = z
  .array(historyItemSchema)
  .openapi("HistoryList");

export const historyListResponseExample = {
  data: [
    {
      kind: "task",
      id: "tsk_123",
      title: "Review onboarding flow",
      description: "Audit copy and empty states",
      status: TaskStatus.RUNNING,
      updatedAt: "2025-01-21T12:00:00.000Z",
      archivedAt: null,
      credits: 2.5,
      projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      coworkerId: "cow_123",
    },
    {
      kind: "job",
      id: "job_123",
      title: "Research competitors",
      description: "Generated market summary",
      status: SokosumiJobStatus.COMPLETED,
      updatedAt: "2025-01-21T11:30:00.000Z",
      archivedAt: null,
      credits: 5,
      projectId: null,
      agentId: "agent_123",
    },
    {
      kind: "conversation",
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Chat with Hannah",
      description: null,
      status: "active",
      updatedAt: "2025-01-21T11:00:00.000Z",
      archivedAt: null,
      credits: null,
      bucketSlug: "hannah",
    },
  ],
  meta: {
    timestamp: "2025-01-21T12:00:00.000Z",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    pagination: {
      cursor: null,
      limit: 20,
      total: 200,
      nextCursor: "tsk_123",
    },
  },
};

export type HistoryItem = z.infer<typeof historyItemSchema>;
