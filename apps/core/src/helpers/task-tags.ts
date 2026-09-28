import { z } from "@hono/zod-openapi";

/** Stable IDs describe subject/work, never status, project, person, or file format. */
export const TASK_TAG_VOCABULARY = {
  research: "Research and fact finding",
  strategy: "Planning and strategic recommendations",
  writing: "Drafting or editing written content",
  design: "Visual design and creative production",
  analysis: "Data analysis, reporting, and measurement",
  development: "Software implementation and technical maintenance",
  marketing: "Marketing campaigns and audience acquisition",
  social: "Social media content and community work",
  seo: "Search engine optimization",
  operations: "Business operations and process work",
} as const;

export const TASK_TAG_IDS = Object.keys(TASK_TAG_VOCABULARY) as [
  keyof typeof TASK_TAG_VOCABULARY,
  ...Array<keyof typeof TASK_TAG_VOCABULARY>,
];
export const taskTagIdSchema = z.enum(TASK_TAG_IDS).openapi("TaskTagId");
export const TASK_TAG_VOCABULARY_VERSION = 1;
export const MAX_TASK_TAGS = 5;

export const taskTagsSchema = z
  .object({
    automatic: z.array(taskTagIdSchema),
    manual: z.array(taskTagIdSchema),
    rejected: z.array(taskTagIdSchema),
  })
  .openapi("TaskTags");

interface StoredTaskTags {
  automaticTags?: string[];
  manualTags?: string[];
  rejectedTags?: string[];
}

function knownTags(ids: string[] = []) {
  return [...new Set(ids)].filter(
    (id): id is keyof typeof TASK_TAG_VOCABULARY =>
      Object.hasOwn(TASK_TAG_VOCABULARY, id),
  );
}

export function mapTaskTags(task: StoredTaskTags) {
  const manual = knownTags(task.manualTags);
  const rejected = knownTags(task.rejectedTags);
  return {
    automatic: knownTags(task.automaticTags)
      .filter((id) => !manual.includes(id) && !rejected.includes(id))
      .slice(0, Math.max(0, MAX_TASK_TAGS - manual.length)),
    manual,
    rejected,
  };
}

const answerSchema = z.object({
  type: z.literal("boolean"),
  probability: z.number().finite().min(0).max(1),
});
const answersSchema = z.record(taskTagIdSchema, answerSchema);

/** Require all known answers; unknown keys and malformed scores fail the whole result. */
export function parseTaskTagAnswers(input: unknown) {
  const answers = answersSchema.parse(input);
  return TASK_TAG_IDS.filter((id) => answers[id].probability >= 0.85)
    .sort(
      (a, b) =>
        answers[b].probability - answers[a].probability || a.localeCompare(b),
    )
    .slice(0, MAX_TASK_TAGS);
}
