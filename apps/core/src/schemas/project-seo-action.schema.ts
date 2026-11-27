import { z } from "@hono/zod-openapi";
import { publicExplorationText, publicExplorationUrl } from "@sokosumi/utils";
import { dateTimeSchema } from "@/helpers/datetime";
import { seoActionImpactSchema } from "./seo-action-impact.schema";
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
const sourceKind = z.enum(["page", "market"]);
const typedRecords = z
  .array(z.strictObject({ record: z.hash("sha256"), sourceKind }))
  .min(2)
  .max(4);
export const singlePageSourceSchema = publicPageSnapshotSchema.extend({
  records: typedRecords,
});
export const publicDecisionSourceSchema = publicPageSnapshotSchema.extend({
  records: typedRecords.optional(),
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
  sourceKind: sourceKind.optional(),
  record: z.hash("sha256"),
  quote: publicText(8, 180),
});
export const rankReviewTrigger = z.strictObject({
  kind: z.literal("rank_crosses"),
  keyword: visible(256),
  position: z.number().int().positive(),
  boundary: z.literal(10),
});
const rankDecision = fixedDecision.extend({
  kind: z.literal("content_opportunity"),
  reviewTrigger: rankReviewTrigger.optional(),
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
      (urls.size >= 2 ||
        (d.observations.every(
          (o) => o.sourceKind && o.snapshotId === d.observations[0]!.snapshotId,
        ) &&
          d.observations.some(
            (p) =>
              p.sourceKind === "page" &&
              d.observations.some(
                (m) =>
                  m.sourceKind === "market" &&
                  m.record !== p.record &&
                  m.quote !== p.quote,
              ),
          ))) &&
      quotes.size >= 2 &&
      new Set(d.evidence).size >= 2 &&
      !!target &&
      d.observations.every((o) => URL.parse(o.url)?.origin === target.origin) &&
      d.evidence.length === d.observations.length &&
      d.observations.every((o, i) => o.record === d.evidence[i])
    );
  });
export const publicSeoDecisionSchema = z.discriminatedUnion("kind", [
  rankDecision,
  fixedDecision.extend({
    kind: z.enum(["internal_link_opportunity", "offer_availability"]),
  }),
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
export const privateReviewKinds = [
  "engagement_changed",
  "purchase_rate_changed",
  "signup_rate_changed",
] as const;
export const reviewKinds = [
  "rank_crosses",
  "demand_returns",
  ...privateReviewKinds,
] as const;
const measurement = z.object({
  before: z.number().nonnegative(),
  after: z.number().nonnegative(),
  period: z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
    .optional(),
  baselineObservationId: seoIdSchema,
  baselineObservedAt: dateTimeSchema,
  observationId: seoIdSchema,
  observedAt: dateTimeSchema,
});
const measuredPeriod = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  sessions: z.number().int().positive(),
});
export const seoFollowUpReview = z.discriminatedUnion("kind", [
  measurement.extend({
    kind: z.enum(["rank_crosses", "demand_returns"]),
    keyword: visible(256),
  }),
  measurement.extend({
    kind: z.enum(privateReviewKinds),
    beforePeriod: measuredPeriod,
    afterPeriod: measuredPeriod,
  }),
]);
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
    followUpReview: seoFollowUpReview.optional(),
    taskId: z.string().nullable(),
    status: z.enum([
      "recommended",
      "needs_review",
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
    /** Set for the human who requested the audits, once an audit read this page's daily Search Console rows alone. */
    impact: seoActionImpactSchema.optional(),
    /**
     * A fix's issues in the page checks after its own: failing where one still fails on a device the fix names, fixed
     * where every one passed there. For each issue and device the newest check that read its rule decides. Absent
     * where no later check read one of them.
     */
    lastCheckResult: z.enum(["failing", "fixed"]).optional(),
    /** When the newest check that decided lastCheckResult ran. */
    lastCheckAt: dateTimeSchema.optional(),
    /** A fix comes from a confirmed check. An opportunity is a named heuristic over measured search data. */
    kind: z.enum(["fix", "opportunity"]),
    evidence: z.array(z.string()),
  })
  .openapi("ProjectSeoAction");
