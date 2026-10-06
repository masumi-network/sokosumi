import { z } from "@hono/zod-openapi";
import { chatResultReferenceSchema } from "@sokosumi/soko-bot";
import { dateTimeSchema } from "@/helpers/datetime";
import { taskTagsSchema } from "@/helpers/task-tags";
import {
  taskPrioritySchema,
  taskStatusSchema,
  taskVisibilitySchema,
} from "@/schemas/domain-enums.schema";
import { socialPostProviderSchema } from "@/schemas/social-post.schema";
import { sokoBotPendingDecisionSchema } from "@/schemas/soko-bot-pending-decision.schema";

const localHref = z
  .string()
  .max(2000)
  .regex(/^\/(?![\/\\])[^\\\r\n]*$/);
const outputSchema = z
  .object({
    name: z.string().max(500),
    contentType: z.string().max(255).nullable(),
    sizeBytes: z.number().nonnegative().nullable(),
    openHref: localHref,
    previewHref: localHref.nullable(),
    downloadHref: localHref.nullable().default(null),
  })
  .openapi("ChatResultOutput");

const actorSchema = z.object({
  id: z.string().max(200),
  name: z.string().max(500),
  image: z.string().max(2000).nullable().default(null),
  kind: z.enum(["user", "coworker", "sokoBot"]),
  slug: z.string().max(200).optional(),
  avatarSeed: z.string().max(200).nullable().default(null),
});
const projectSchema = z.object({
  id: z.string().max(200),
  name: z.string().max(500),
  identifier: z.string().nullable(),
  logo: z.string().max(2000).nullable(),
});
const taskPreviewSchema = z
  .object({
    id: z.string().max(200),
    name: z.string().max(500),
    identifier: z.string().max(200).nullable(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    visibility: taskVisibilitySchema,
    createdAt: dateTimeSchema.nullable(),
    runAt: dateTimeSchema.nullable(),
    project: projectSchema.nullable(),
    assignee: actorSchema.nullable(),
    participants: z.array(actorSchema).max(6),
    commentsCount: z.number().int().nonnegative(),
    tags: taskTagsSchema,
  })
  .openapi("ChatResultTask");
const socialPreviewSchema = z
  .object({
    provider: socialPostProviderSchema,
    account: z
      .object({
        handle: z.string().max(500).nullable(),
        displayName: z.string().max(500).nullable(),
        avatarUrl: z.string().max(2000).nullable(),
      })
      .nullable(),
    timestamp: dateTimeSchema.nullable(),
  })
  .openapi("ChatResultSocial");

export const chatResultAvailableSchema = z
  .object({
    id: z.string().uuid(),
    state: z.literal("available"),
    capturedAt: dateTimeSchema,
    kind: z.enum([
      "task",
      "task_schedule",
      "bot_schedule",
      "social_post",
      "studio_job",
      "job",
      "file",
      "decision",
    ]),
    title: z.string().max(500),
    // Each resource retains its native state; Core reads it, never the model.
    status: z.string().max(100).nullable(),
    summary: z.string().max(4000).nullable().default(null),
    sourceHref: localHref,
    assignee: z.string().max(500).nullable().default(null),
    project: z.string().max(500).nullable().default(null),
    destination: z.string().max(500).nullable().default(null),
    scheduledAt: dateTimeSchema.nullable().default(null),
    timezone: z.string().max(100).nullable().default(null),
    recurrence: z.string().max(200).nullable().default(null),
    question: z.string().max(4000).nullable().default(null),
    outputs: z.array(outputSchema).max(12).default([]),
    task: z.union([taskPreviewSchema, z.null()]).default(null),
    social: z.union([socialPreviewSchema, z.null()]).default(null),
    actor: z.union([actorSchema, z.null()]).default(null),
    agent: z
      .object({
        name: z.string().max(500),
        icon: z.string().max(2000).nullable(),
      })
      .nullable()
      .default(null),
    projectInfo: z.union([projectSchema, z.null()]).default(null),
    decision: z.union([sokoBotPendingDecisionSchema, z.null()]).default(null),
  })
  .openapi("ChatResultAvailable");

export const chatResultPreviewSchema = z
  .discriminatedUnion("state", [
    chatResultAvailableSchema,
    z
      .object({ id: z.string().uuid(), state: z.literal("unavailable") })
      .openapi("ChatResultUnavailable"),
  ])
  .openapi("ChatResultPreview");

/** Private persisted JSON. Only the protected result endpoints expose its data. */
export const chatResultSnapshotSchema = z.object({
  workspaceId: z.string(),
  reference: chatResultReferenceSchema,
  data: chatResultAvailableSchema,
});

export type ChatResultSnapshot = z.infer<typeof chatResultSnapshotSchema>;
export type ChatResultAvailable = z.infer<typeof chatResultAvailableSchema>;
export type ChatResultPreview = z.infer<typeof chatResultPreviewSchema>;
