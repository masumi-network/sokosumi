import { z } from "@hono/zod-openapi";

import { searchConsoleDay } from "@/lib/seo/native-statistics";
import { seoPageComparisonKey } from "@/lib/seo/related-page-selection";
import { searchConsoleDate } from "@/schemas/seo-impact.schema";

/**
 * The seo-bot worker's impact contract (seo-bot agent/lib/impact-request.ts and
 * impact-run.ts). The worker parses the input strictly, so Core checks what it
 * stores against the same limits: an input the worker refuses ends its claims.
 */
export const SEO_IMPACT_INPUT_SCHEMA = "sokosumi.seo-impact-input/1";
export const SEO_IMPACT_RESULT_SCHEMA = "sokosumi.seo-impact/1";
/** The worker compares the page with at most this many unchanged pages (seo-bot MAX_IMPACT_CANDIDATES). */
export const SEO_IMPACT_MAX_CANDIDATES = 5;
/** The worker refuses a series with more rows, or a row older than this many days before readAt (seo-bot MAX_SERIES_DAYS). */
export const SEO_IMPACT_MAX_SERIES_DAYS = 490;
/** The worker reads at most this many bytes of the claim reply (seo-bot IMPACT_INPUT_MAX_BYTES). */
export const SEO_IMPACT_INPUT_MAX_BYTES = 1_091_072;
/** The worker's URL limit (seo-bot MAX_ANALYSIS_URL_CHARS). */
export const SEO_IMPACT_MAX_URL_CHARS = 4096;
/** The worker's Search Console property limit. */
export const SEO_IMPACT_MAX_PROPERTY_CHARS = 2048;
/** The worker's CTR check allows floating-point roundoff only (seo-bot gsc.ts). */
const CTR_ROUNDOFF_TOLERANCE = Number.EPSILON * 8;
const DAY_MS = 86_400_000;

// The worker reads each time with Date.parse, which keeps milliseconds only.
const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => !/\.\d{4}/.test(value), "At most 3 fractional digits");
// The worker refuses credentials and fragments, and echoes new URL(value).href:
// Core stores that form, so the echo matches it.
const pageUrl = z
  .url({ protocol: /^https?$/ })
  .max(SEO_IMPACT_MAX_URL_CHARS)
  .refine((value) => {
    // The url check above does not stop this check, so the value can be invalid.
    const url = URL.parse(value);
    return (
      !!url && !url.username && !url.password && !url.hash && url.href === value
    );
  }, "A page URL in the worker's form: no credentials, no fragment");
// The worker refuses a day the calendar does not have, such as 2026-02-30.
const calendarDate = searchConsoleDate.refine((date) => {
  const time = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(date);
}, "No such day");

const dailyRow = z
  .object({
    date: calendarDate,
    clicks: z.int().min(0),
    impressions: z.int().min(0),
    ctr: z.number().min(0).max(1),
    position: z.number().min(0),
  })
  .strict()
  .refine((row) => row.clicks <= row.impressions, "Clicks exceed impressions")
  .refine(
    (row) =>
      Math.abs(
        row.ctr - (row.impressions ? row.clicks / row.impressions : 0),
      ) <= CTR_ROUNDOFF_TOLERANCE,
    "CTR does not match clicks and impressions",
  )
  .refine(
    (row) => row.impressions === 0 || row.position >= 1,
    "A day with impressions has a position of at least 1",
  );
export type SeoImpactDailyRow = z.infer<typeof dailyRow>;

const daily = z
  .array(dailyRow)
  .max(SEO_IMPACT_MAX_SERIES_DAYS)
  .refine(
    (rows) => new Set(rows.map((row) => row.date)).size === rows.length,
    "A date appears twice",
  );

export const seoImpactInputSchema = z
  .object({
    schema: z.literal(SEO_IMPACT_INPUT_SCHEMA),
    impactId: z.uuid(),
    pageUrl,
    property: z.string().min(1).max(SEO_IMPACT_MAX_PROPERTY_CHARS),
    changedAt: instant,
    changeSource: z.enum(["cuso_done", "audit_recheck"]),
    changeBounds: z
      .object({ earliest: instant, latest: instant })
      .strict()
      .nullable(),
    changeCheck: z.enum(["verified", "not_checked"]),
    /** The first crawl after the change. */
    windowCrawl: instant,
    pageByDate: daily,
    siteByDate: daily,
    candidates: z
      .array(z.object({ pageUrl, byDate: daily }).strict())
      .max(SEO_IMPACT_MAX_CANDIDATES),
    pin: z.object({ comparisonPage: pageUrl }).strict().nullable(),
    readAt: instant,
  })
  .strict()
  .superRefine((value, ctx) => {
    // Zod runs this check on a value whose fields failed too: the checks
    // below read times and URLs that the field checks accepted.
    if (ctx.issues.length) return;
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const readAt = Date.parse(value.readAt);
    if (Date.parse(value.changedAt) > readAt) fail("changedAt is after readAt");
    if (Date.parse(value.windowCrawl) > readAt)
      fail("windowCrawl is after readAt");
    const readDay = searchConsoleDay(new Date(readAt));
    // A year before 1000 has no four-digit Pacific day, as the worker refuses.
    if (!calendarDate.safeParse(readDay).success)
      return fail("readAt has no Search Console day");
    const oldest = new Date(
      Date.parse(`${readDay}T00:00:00Z`) - SEO_IMPACT_MAX_SERIES_DAYS * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    for (const rows of [
      value.pageByDate,
      value.siteByDate,
      ...value.candidates.map((candidate) => candidate.byDate),
    ]) {
      if (rows.some((row) => row.date > readDay))
        fail("A daily row is dated after the Pacific day of readAt");
      if (rows.some((row) => row.date < oldest))
        fail("A daily row is too old for readAt");
    }
    const origin = new URL(value.pageUrl).origin;
    const page = seoPageComparisonKey(value.pageUrl);
    const candidates = value.candidates.map((candidate) =>
      seoPageComparisonKey(candidate.pageUrl),
    );
    if (
      value.candidates.some(
        (candidate) => new URL(candidate.pageUrl).origin !== origin,
      )
    )
      fail("A candidate is on another origin than the page");
    if (candidates.includes(page)) fail("A candidate is the changed page");
    if (new Set(candidates).size !== candidates.length)
      fail("A candidate appears twice");
    if (
      value.pin &&
      !value.candidates.some(
        (candidate) => candidate.pageUrl === value.pin?.comparisonPage,
      )
    )
      fail("The pinned comparison page is not a candidate");
    const bounds = value.changeBounds;
    if ((value.changeSource === "cuso_done") !== (bounds === null))
      fail("Only an audit recheck has change bounds");
    else if (
      bounds &&
      (Date.parse(bounds.earliest) !== Date.parse(value.changedAt) ||
        Date.parse(bounds.latest) < Date.parse(bounds.earliest) ||
        Date.parse(bounds.latest) > readAt)
    )
      fail("Change bounds start at changedAt and end by readAt");
  })
  .openapi("SeoImpactInput");
export type SeoImpactInput = z.infer<typeof seoImpactInputSchema>;

/** Every worker state but `waiting` is final. */
export const SEO_IMPACT_FINAL_STATES = [
  "change not confirmed",
  "not crawled after change",
  "tested",
] as const;
const resultState = z.enum([...SEO_IMPACT_FINAL_STATES, "waiting"]);

/**
 * The worker's result. Core reads only the fields named here and stores the
 * whole result, so the other fields pass through unchanged.
 */
export const seoImpactResultSchema = z
  .looseObject({
    schema: z.literal(SEO_IMPACT_RESULT_SCHEMA),
    impactId: z.uuid(),
    pageUrl: z.string(),
    property: z.string(),
    changedAt: z.string(),
    changeSource: z.enum(["cuso_done", "audit_recheck"]),
    /** The input's readAt: which input the result answers. */
    observedAt: z.string(),
    windowCrawl: z.string(),
    state: resultState,
    verdict: z
      .looseObject({
        verdict: z.enum([
          "effect detected",
          "no effect detected",
          "not measurable",
        ]),
      })
      .nullable(),
    comparison: z
      .looseObject({
        pageUrl: z.string().max(SEO_IMPACT_MAX_URL_CHARS).nullable(),
      })
      .nullable(),
    /** State `waiting` only: the day Core can read again. */
    retryAfter: calendarDate.nullable(),
  })
  .refine(
    (result) => (result.state === "waiting") === (result.retryAfter !== null),
    "retryAfter is set for state waiting only",
  )
  // The worker gives a verdict for every tested change, and none otherwise.
  .refine(
    (result) => (result.state === "tested") === (result.verdict !== null),
    "A verdict is set for state tested only",
  )
  .openapi("SeoImpactResult");
export type SeoImpactResult = z.infer<typeof seoImpactResultSchema>;

// A union, not .nullable(): the generated client must read an empty queue's null.
export const seoImpactClaimSchema = z.union([
  z
    .object({
      claimId: z.uuid(),
      /** The claim ends then: another claim can take the change after it. */
      claimedUntil: z.iso.datetime(),
      input: seoImpactInputSchema,
    })
    .openapi("SeoImpactClaim"),
  z.null(),
]);

export const seoImpactVerdictReceiptSchema = z
  .object({ impactId: z.uuid(), state: resultState })
  .openapi("SeoImpactVerdictReceipt");
