import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";

import { dateTimeSchema } from "@/helpers/datetime";
import {
  sokosumiJobStatusSchema,
  taskStatusSchema,
} from "@/schemas/domain-enums.schema";

const historyOwnerObjectSchema = z
  .object({
    userId: z.string().openapi({
      description: "User ID of the history item owner",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    name: z.string().openapi({
      description: "Display name of the owner",
      example: "Alice Johnson",
    }),
    image: z.string().nullable().openapi({
      description: "Profile image URL of the owner. Null when no image is set.",
      example: "https://example.com/avatar.jpg",
    }),
  })
  .openapi("HistoryOwner");

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
  // Union-with-null instead of `historyOwnerObjectSchema.nullable()`:
  // `.nullable()` on a named `.openapi(...)` schema leaks `| null` into the
  // generated `HistoryOwner` component and makes the client transformer call
  // the owner converter unconditionally (crashing on null). Mirrors
  // `jobSchema.share` / `taskSchema.share`.
  owner: z.union([historyOwnerObjectSchema, z.null()]).openapi({
    description:
      "Owner of the history item. Null when the user is deleted or could not be resolved.",
    example: null,
  }),
});

export const historyTaskItemSchema = historyBaseItemSchema
  .extend({
    kind: z.literal("task"),
    status: taskStatusSchema.openapi({ example: TaskStatus.RUNNING }),
    projectId: z.string().uuid().nullable().openapi({
      description: "Project ID for the task, when assigned",
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    coworkerId: z.string().nullable().openapi({
      description: "Coworker ID associated with the task, when assigned",
      example: "cow_123",
    }),
    orchestratorId: z.string().uuid().nullable().openapi({
      description: "Soko Bot ID associated with the task, when assigned",
      example: "01960001-0001-7001-8001-000000000099",
    }),
  })
  .openapi("HistoryTaskItem");

export const historyJobItemSchema = historyBaseItemSchema
  .extend({
    kind: z.literal("job"),
    status: sokosumiJobStatusSchema.openapi({
      example: SokosumiJobStatus.COMPLETED,
    }),
    projectId: z.string().uuid().nullable().openapi({
      description: "Project ID for the job, when assigned",
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    agentId: z.string().openapi({
      description: "Agent ID for deep-linking to the job",
      example: "agent_123",
    }),
    agentName: z.string().nullable().openapi({
      description:
        "Resolved display name of the job's agent (override name when set). Null when the agent could not be resolved.",
      example: "Research Agent",
    }),
    agentIcon: z.string().nullable().openapi({
      description:
        "Resolved icon URL for the job's agent. Null when the agent has no valid icon or could not be resolved.",
      example: "https://example.com/research.svg",
    }),
  })
  .openapi("HistoryJobItem");

export const historyItemSchema = z
  .discriminatedUnion("kind", [historyTaskItemSchema, historyJobItemSchema])
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
      orchestratorId: null,
      owner: {
        userId: "550e8400-e29b-41d4-a716-446655440001",
        name: "Alice Johnson",
        image: "https://example.com/avatar.jpg",
      },
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
      agentName: "Research Agent",
      agentIcon: "https://example.com/research.svg",
      owner: {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        name: "Bob Smith",
        image: null,
      },
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
