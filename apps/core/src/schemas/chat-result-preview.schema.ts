import { z } from "@hono/zod-openapi";
import { chatResultReferenceSchema } from "@sokosumi/soko-bot";
import { dateTimeSchema } from "@/helpers/datetime";
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
