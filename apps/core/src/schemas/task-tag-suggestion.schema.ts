import { z } from "@hono/zod-openapi";
import { MAX_TASK_TAGS, taskTagIdSchema } from "@/helpers/task-tags";
import { tagColorSchema } from "@/schemas/tag-color.schema";

// A title alone is often enough to classify, and the old 40-character floor meant
// roughly 50 typed characters before the composer showed anything. The client-side
// gate in `use-task-tag-suggestions.ts` matches this number; spend stays bounded by
// the debounce, the per-request cooldown, and the per-user rate limits, not by it.
export const MIN_TASK_TAG_SUGGESTION_CHARACTERS = 15;

export const taskTagSuggestionInputSchema = z
  .object({
    name: z.string().max(300).optional(),
    description: z.string().max(8_000).nullish(),
  })
  .refine(
    (value) =>
      `${value.name ?? ""}${value.description ?? ""}`.replace(
        /[^\p{L}\p{N}]/gu,
        "",
      ).length >= MIN_TASK_TAG_SUGGESTION_CHARACTERS,
    `Provide at least ${MIN_TASK_TAG_SUGGESTION_CHARACTERS} letters or numbers`,
  );

export const taskTagSuggestionResponseSchema = z
  .object({
    tags: z.array(taskTagIdSchema).max(MAX_TASK_TAGS),
    workspaceSuggestions: z
      .array(
        z.object({
          id: z.uuid(),
          displayName: z.string(),
          color: tagColorSchema.nullish(),
          autoApply: z.boolean(),
        }),
      )
      .max(MAX_TASK_TAGS)
      .optional(),
    receipt: z.string(),
  })
  .openapi("TaskTagSuggestion");
