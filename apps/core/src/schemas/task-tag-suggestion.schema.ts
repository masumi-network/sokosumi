import { z } from "@hono/zod-openapi";
import { MAX_TASK_TAGS, taskTagIdSchema } from "@/helpers/task-tags";

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
      ).length >= 40,
    "Provide at least 40 letters or numbers",
  );

export const taskTagSuggestionResponseSchema = z
  .object({
    tags: z.array(taskTagIdSchema).max(MAX_TASK_TAGS),
    receipt: z.string(),
  })
  .openapi("TaskTagSuggestion");

export const taskTagCorrectionsSchema = z
  .object({
    add: z.array(taskTagIdSchema).max(MAX_TASK_TAGS).default([]),
    remove: z.array(taskTagIdSchema).max(10).default([]),
  })
  .refine(
    (value) => !value.add.some((id) => value.remove.includes(id)),
    "A tag cannot be both added and removed",
  );
