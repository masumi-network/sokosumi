import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const taskAttachmentSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    url: z.string().openapi({ example: "https://example.com/file.pdf" }),
    name: z.string().nullish().openapi({ example: "file.pdf" }),
    mimeType: z
      .string()
      .nullish()
      .openapi({ example: "application/pdf" }),
    size: z.number().nullish().openapi({ example: 1024 }),
  })
  .openapi("TaskAttachment");

export const taskActorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
  }),
  z.object({
    type: z.literal("orchestrator"),
    orchestratorId: z.string().openapi({ example: "orc_123" }),
  }),
]);

export const orchestratorSchema = z
  .object({
    id: z.string().openapi({ example: "orc_123" }),
    slug: z.string().openapi({ example: "ops-agent" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    url: z.string().nullish().openapi({ example: "https://example.com" }),
    email: z.string().nullish().openapi({ example: "ops@example.com" }),
    description: z.string().nullish().openapi({ example: "Ops helper" }),
    image: z.string().nullish().openapi({ example: "https://example.com/logo" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("Orchestrator");

export const taskEventSchema = z
  .object({
    id: z.string().openapi({ example: "evt_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.RUNNING }),
    userId: z.string().nullish().openapi({ example: "user_123" }),
    orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
  })
  .openapi("TaskEvent");

export const taskCommentSchema = z
  .object({
    id: z.string().openapi({ example: "com_123" }),
    content: z.string().openapi({ example: "Looks good." }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().nullish().openapi({ example: "user_123" }),
    orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
    attachments: z.array(taskAttachmentSchema).openapi({ example: [] }),
  })
  .openapi("TaskComment");

export const taskLastEventSchema = z
  .object({
    createdAt: dateTimeSchema,
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
  })
  .openapi("TaskLastEvent");

export const taskBoardItemSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_123" }),
    name: z.string().openapi({ example: "Review onboarding" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
    orchestrator: orchestratorSchema.nullish(),
    _count: z
      .object({
        comments: z.number().openapi({ example: 2 }),
      })
      .openapi("TaskBoardItemCount"),
    lastEvent: taskLastEventSchema.nullish(),
    updatedAt: dateTimeSchema,
  })
  .openapi("TaskBoardItem");

export const taskBoardColumnSchema = z
  .object({
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
    tasks: z.array(taskBoardItemSchema),
  })
  .openapi("TaskBoardColumn");

export const taskBoardResponseSchema = z
  .object({
    columns: z.array(taskBoardColumnSchema),
  })
  .openapi("TaskBoardResponse");

export const taskDetailSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_123" }),
    name: z.string().openapi({ example: "Review onboarding" }),
    description: z.string().nullish().openapi({ example: "Notes go here" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.DRAFT }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    orchestrator: orchestratorSchema.nullish(),
    events: z.array(taskEventSchema),
    comments: z.array(taskCommentSchema),
    attachments: z.array(taskAttachmentSchema),
  })
  .openapi("TaskDetail");

export const createTaskRequestSchema = z.object({
  name: z.string().min(1).max(120).openapi({ example: "Review onboarding" }),
  description: z.string().nullish().openapi({ example: "Notes go here" }),
  orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
});

export const updateTaskRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional().openapi({
      example: "Updated task title",
    }),
    description: z.string().nullish().optional().openapi({
      example: "Updated description",
    }),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined,
    {
      message: "At least one field must be provided",
      path: ["name", "description"],
    },
  );

export const createOrchestratorRequestSchema = z.object({
  slug: z.string().min(1).max(64).openapi({ example: "ops-agent" }),
  name: z.string().min(1).max(120).openapi({ example: "Ops Agent" }),
  url: z.string().nullish().openapi({ example: "https://example.com" }),
  email: z.string().nullish().openapi({ example: "ops@example.com" }),
  description: z.string().nullish().openapi({ example: "Ops helper" }),
  image: z.string().nullish().openapi({ example: "https://example.com/logo" }),
});

export const updateOrchestratorRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional().openapi({
      example: "Ops Agent",
    }),
    url: z.string().nullish().optional().openapi({
      example: "https://example.com",
    }),
    email: z.string().nullish().optional().openapi({
      example: "ops@example.com",
    }),
    description: z.string().nullish().optional().openapi({
      example: "Ops helper",
    }),
    image: z.string().nullish().optional().openapi({
      example: "https://example.com/logo",
    }),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.url !== undefined ||
      data.email !== undefined ||
      data.description !== undefined ||
      data.image !== undefined,
    {
      message: "At least one field must be provided",
      path: ["name", "url", "email", "description", "image"],
    },
  );

export const createTaskCommentRequestSchema = z.object({
  content: z.string().min(1).openapi({ example: "Looks good." }),
  actor: taskActorSchema.optional(),
});

export const updateTaskCommentRequestSchema = z
  .object({
    content: z.string().min(1).openapi({ example: "Updated comment" }),
  })
  .openapi("UpdateTaskCommentRequest");

const setStatusActionSchema = z.object({
  type: z.literal("SET_STATUS"),
  to: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
});

const setOrchestratorActionSchema = z.object({
  type: z.literal("SET_ORCHESTRATOR"),
  orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
});

const commentActionSchema = z.object({
  type: z.literal("COMMENT"),
  body: z.string().min(1).openapi({ example: "Looks good." }),
});

export const taskActionSchema = z.discriminatedUnion("type", [
  setStatusActionSchema,
  setOrchestratorActionSchema,
  commentActionSchema,
]);

export const taskCommandRequestSchema = z.object({
  actor: taskActorSchema,
  action: taskActionSchema,
});
