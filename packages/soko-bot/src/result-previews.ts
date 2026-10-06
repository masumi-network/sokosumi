import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const resource = { id };

/** Models identify resources; Core supplies every displayed field. */
export const chatResultReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), ...resource }).strict(),
  z.object({ kind: z.literal("task_schedule"), ...resource }).strict(),
  z.object({ kind: z.literal("bot_schedule"), ...resource }).strict(),
  z
    .object({ kind: z.literal("social_post"), ...resource, projectId: id })
    .strict(),
  z
    .object({ kind: z.literal("studio_job"), ...resource, projectId: id })
    .strict(),
  z.object({ kind: z.literal("job"), ...resource }).strict(),
  z.object({ kind: z.literal("file"), ...resource }).strict(),
  z.object({ kind: z.literal("decision"), ...resource }).strict(),
  z
    .object({
      kind: z.literal("project_selection"),
      projectIds: z.array(id).min(1).max(12),
    })
    .strict(),
]);

export type ChatResultReference = z.infer<typeof chatResultReferenceSchema>;
export const CHAT_RESULT_PREVIEW_LIMIT = 6;
export const sokoBotPreviewResultInputSchema = z
  .object({ reference: chatResultReferenceSchema })
  .strict();
