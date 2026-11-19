import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import {
  publicExplorationText,
  publicExplorationUrl,
} from "@/helpers/project-seo-exploration-privacy";
import { seoIdSchema, seoUrlSchema } from "./seo-page.schema";

export const MAX_RANKED_DECISIONS = 5;
export const MAX_STRATEGY_DECISIONS = MAX_RANKED_DECISIONS + 1;
const visible = (limit: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(limit)
    .refine(
      (value) =>
        ![...value].some((char) => {
          const code = char.codePointAt(0)!;
          return (
            code < 32 ||
            code === 127 ||
            (code >= 0x202a && code <= 0x202e) ||
            (code >= 0x2066 && code <= 0x2069)
          );
        }),
    );
const sentence = visible(600);
const fixedKinds = [
  "content_opportunity",
  "internal_link_opportunity",
  "offer_availability",
] as const;
export const OPEN_STRATEGY = "open_strategy_opportunity";
const isOpenDecision = (row: unknown): boolean =>
  !!row &&
  typeof row === "object" &&
  "kind" in row &&
  row.kind === OPEN_STRATEGY;
/** One additional experiment can accompany up to five ranked recommendations. */
export function withinStrategyLimit(rows: readonly unknown[]) {
  if (rows.length > MAX_STRATEGY_DECISIONS) return false;
  const open = rows.filter(isOpenDecision).length;
  return open <= 1 && rows.length - open <= MAX_RANKED_DECISIONS;
}
const decisionDetail = z.object({
  kind: z.enum([...fixedKinds, OPEN_STRATEGY]),
  alternative: sentence,
  nextCheck: sentence,
});
/** Only public decision types from a full audit may enter shared actions. */
const fixedDecision = decisionDetail
  .extend({
    kind: z.enum(fixedKinds),
    id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/),
    targetUrl: seoUrlSchema.max(2048).refine((value) => !value.includes("#")),
    action: sentence,
    reason: sentence,
    evidence: z.array(visible(256)).min(1).max(8),
  })
  .strict();
const publicUrl = seoUrlSchema.max(2048).refine(publicExplorationUrl);
const publicText = (min: number, max: number) =>
  visible(max).refine(
    (value) => value.length >= min && publicExplorationText(value),
  );
const publicSentence = publicText(10, 380);
export const publicPageSnapshotSchema = z.strictObject({
  url: publicUrl,
  snapshotId: z.hash("sha256"),
});
export const publicDecisionSourceSchema = publicPageSnapshotSchema.extend({
  market: z
    .strictObject({
      siteSnapshotId: z.hash("sha256"),
      record: z.hash("sha256"),
    })
    .optional(),
});
export const marketSourceSchema = z.strictObject({
  provider: z.literal("dataforseo"),
  url: publicUrl,
  pageSnapshotId: z.hash("sha256"),
  record: z.hash("sha256"),
});
const observationSchema = publicPageSnapshotSchema.extend({
  record: z.hash("sha256"),
  quote: publicText(8, 180),
});
const experiment = fixedDecision
  .extend({
    kind: z.literal(OPEN_STRATEGY),
    id: z.string().regex(/^open_strategy_opportunity:[a-f0-9]{1,16}$/),
    targetUrl: publicUrl,
    action: publicSentence,
    reason: publicSentence,
    alternative: publicSentence,
    nextCheck: publicSentence,
    observations: z.array(observationSchema).min(2).max(4),
    evidence: z.array(z.hash("sha256")).min(2).max(4),
  })
  .refine((d) => {
    const urls = new Set(d.observations.map((o) => o.url));
    const quotes = new Set(d.observations.map((o) => o.quote));
    const target = URL.parse(d.targetUrl);
    return (
      urls.has(d.targetUrl) &&
      urls.size >= 2 &&
      quotes.size >= 2 &&
      new Set(d.evidence).size >= 2 &&
      !!target &&
      d.observations.every((o) => URL.parse(o.url)?.origin === target.origin) &&
      d.evidence.length === d.observations.length &&
      d.observations.every((o, i) => o.record === d.evidence[i])
    );
  });
export const publicSeoDecisionSchema = z.discriminatedUnion("kind", [
  fixedDecision,
  experiment,
]);
/** A stored optional experiment can predate a tighter public evidence rule. Keep the audited recommendations. */
export const storedSeoDecisionsSchema = z.preprocess(
  (raw) =>
    Array.isArray(raw) && withinStrategyLimit(raw)
      ? raw.filter(
          (row) => !isOpenDecision(row) || experiment.safeParse(row).success,
        )
      : raw,
  z
    .array(publicSeoDecisionSchema)
    .max(MAX_STRATEGY_DECISIONS)
    .refine(withinStrategyLimit),
);
export type PublicSeoDecision = z.infer<typeof publicSeoDecisionSchema>;
export const seoActionSchema = z
  .object({
    id: z.string(),
    observationId: seoIdSchema,
    pageUrl: seoUrlSchema,
    findingIds: z.array(z.string()),
    title: z.string(),
    why: z.string(),
    effort: z.enum(["low", "medium", "high", "unknown"]),
    expectedEffect: z.string(),
    edit: z.union([
      z.object({
        target: z.string(),
        before: z.string().nullable(),
        after: z.string(),
      }),
      z.null(),
    ]),
    decision: decisionDetail.optional(),
    taskId: z.string().nullable(),
    status: z.enum([
      "recommended",
      "task_created",
      "unavailable",
      "implemented",
      "verified",
      "canceled",
      "failed",
    ]),
    /** When the linked Task last completed. Set on an implemented or verified action. */
    completedAt: dateTimeSchema.optional(),
    /** When the last check that shows every finding of the fix gone ran; it can come before completedAt. Set on a verified fix. */
    verifiedAt: dateTimeSchema.optional(),
    /** A fix comes from a confirmed check. An opportunity is a named heuristic over measured search data. */
    kind: z.enum(["fix", "opportunity"]),
    evidence: z.array(z.string()),
  })
  .openapi("ProjectSeoAction");
