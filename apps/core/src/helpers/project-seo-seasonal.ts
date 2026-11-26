import { createHash } from "node:crypto";
import { hasSeasonalDemandRise } from "@sokosumi/utils";
import { z } from "zod";
import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import {
  MAX_SEASONAL_HISTORY_MONTHS,
  seoSeasonalIdeaSchema,
} from "@/schemas/project-seo-seasonal.schema";
import { auditedSeoPageKey } from "./project-seo-site-findings";
import { validateEarlierCycles } from "./seo-seasonal-recurrence";

type SeasonalIdea = z.infer<typeof seoSeasonalIdeaSchema>;

const MONTHS_PER_YEAR = 12;

const workerDemand = z.object({
  status: z.literal("observed"),
  keyword: z.string(),
  months: z
    .array(
      z.object({
        year: z.number().int().min(1900).max(9999),
        month: z.number().int().min(1).max(MONTHS_PER_YEAR),
        search_volume: z.number().int().nonnegative().safe().nullable(),
      }),
    )
    .min(1)
    .max(MAX_SEASONAL_HISTORY_MONTHS),
});

const period = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

/** Months of the query's own history before the audit month. A row that breaks this rule drops the history, not the idea. */
function observedMonths(raw: unknown, idea: SeasonalIdea) {
  const demand = workerDemand.safeParse(
    raw && typeof raw === "object" && "demand" in raw ? raw.demand : undefined,
  );
  if (!demand.success || demand.data.keyword !== idea.keyword) return undefined;
  return completeKeywordMonths(demand.data.months, idea.asOf);
}

export function completeKeywordMonths(input: unknown, asOf: string) {
  const rows = workerDemand.shape.months.safeParse(input);
  if (!rows.success) return;
  const auditMonth = asOf.slice(0, 7);
  const months = rows.data
    .map((row) => ({
      period: period(row.year, row.month),
      volume: row.search_volume,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
  const earliest = `${Number(auditMonth.slice(0, 4)) - 3}${auditMonth.slice(4)}`;
  if (
    months.some(
      (row, index) =>
        row.period >= auditMonth ||
        row.period < earliest ||
        months[index - 1]?.period === row.period,
    )
  )
    return undefined;
  const measured = months.flatMap((row) =>
    row.volume === null ? [] : [{ period: row.period, volume: row.volume }],
  );
  return measured.length ? measured : undefined;
}

/** One worker insight as a public idea. Reviewer identity, record IDs and unknown fields stay out. */
export function readSeasonalInsight(raw: unknown): SeasonalIdea | null {
  const parsed = seoSeasonalIdeaSchema.safeParse(raw);
  if (!parsed.success) return null;
  const {
    observedMonths: _supplied,
    contentPlan,
    trendComparison,
    ...idea
  } = parsed.data;
  const months = observedMonths(raw, idea);
  const supported = validateEarlierCycles(
    idea,
    months ?? [],
    Boolean(contentPlan?.experiment),
  );
  const comparisons = trendComparison?.filter(
    (row) =>
      supported.windows.some(
        (w) => w.historicalPeriod === row.historicalPeriod,
      ) &&
      trendComparison.filter(
        (other) => other.historicalPeriod === row.historicalPeriod,
      ).length === 1,
  );
  return {
    ...supported,
    ...(months && { observedMonths: months }),
    ...(contentPlan && !idea.origin && { contentPlan }),
    ...(comparisons?.length &&
      !idea.marketBasis && { trendComparison: comparisons }),
  };
}

/** Only an update to the audited page with a measured rise, and no open doubt besides timing, becomes work. */
export function seasonalIdeaAction(idea: SeasonalIdea) {
  const experiment = idea.contentPlan?.experiment;
  if (
    (!experiment &&
      idea.contentPlan &&
      idea.contentPlan.disposition !== "clarify") ||
    idea.marketBasis ||
    idea.origin === "market_history" ||
    (!experiment && idea.action !== "improve_existing_page") ||
    idea.limitations.some((limit) => limit !== "timing_uncertain")
  )
    return null;
  const comparison = idea.comparison;
  const eventPeak = Math.max(
    comparison?.leadMonth?.volume ?? 0,
    comparison?.eventMonth?.volume ?? 0,
  );
  const eventRise =
    !!idea.event &&
    comparison?.status === "above_baseline" &&
    comparison.baselineMedian !== null &&
    hasSeasonalDemandRise(eventPeak, comparison.baselineMedian);
  const windows = idea.event
    ? []
    : idea.windows.filter((w) =>
        hasSeasonalDemandRise(w.historicalVolume, w.baselineMedian),
      );
  if (!eventRise && !windows.length) return null;
  const market = `${idea.country}/${idea.language}`;
  // Audience is a reviewer's label and may change on a repeat audit. The work is the page, query and date.
  const identity = JSON.stringify([
    idea.country,
    idea.language,
    auditedSeoPageKey(idea.url),
    idea.keyword.normalize("NFKC").toLowerCase().trim(),
    ...(experiment && idea.action === "investigate_angle"
      ? ["editorial_test"]
      : []),
    idea.event?.name ?? null,
    idea.event?.date ?? [...new Set(windows.map((w) => w.targetPeriod))].sort(),
  ]);
  const timing = idea.event
    ? `${idea.event.name} on ${idea.event.date}`
    : windows.map((w) => w.targetPeriod).join(", ");
  const evidence = [
    ...(idea.contentPlan ? [idea.contentPlan.passage] : []),
    `Page quote: "${idea.pageQuote}"`,
    ...(idea.event && comparison?.baselineMedian != null
      ? [comparison.leadMonth, comparison.eventMonth].flatMap((row) =>
          row?.volume == null
            ? []
            : [
                `${row.period}: ${row.volume} estimated searches in ${market}; earlier median ${comparison.baselineMedian} (DataForSEO)`,
              ],
        )
      : windows.map(
          (w) =>
            `${w.historicalPeriod}: ${w.historicalVolume} estimated searches in ${market}; comparison median ${w.baselineMedian} (DataForSEO)`,
        )),
  ];
  return {
    id: "seasonal:" + createHash("sha256").update(identity).digest("hex"),
    pageUrl: idea.url,
    title:
      idea.contentPlan?.nextStep ??
      `Update the page for "${idea.keyword}" before ${timing}`,
    why: experiment
      ? `Working hypothesis: ${experiment.hypothesis} Target queries to test: ${experiment.targetQueries.join(", ")}. Planning window: ${timing}.`
      : idea.contentPlan
        ? `Review the reader task “${idea.contentPlan.readerTask}” for ${timing}. The timing comes from earlier local search estimates.`
        : `The audited page covers this search for ${idea.audience}. Last year, estimated searches for "${idea.keyword}" rose ${idea.event ? `around ${idea.event.name}` : "in the same months"}. This is a timing suggestion, not a forecast.`,
    expectedEffect:
      experiment?.successCheck ??
      "Hypothesis: an existing page that answers this search before the season can earn more of its visits. Compare the next season; no traffic change is promised.",
    edit: null,
    effort: "unknown" as const,
    kind: "opportunity" as const,
    findingIds: [],
    evidence,
  };
}

/** Seasonal actions of one audit, limited to its market and audited pages. */
export function seasonalPayloadActions(
  data: Pick<
    PublicSeoPayload,
    "pageUrls" | "countryCode" | "languageCode" | "seasonalIdeas"
  >,
) {
  const pages = new Set(data.pageUrls.map(auditedSeoPageKey));
  return (data.seasonalIdeas ?? []).flatMap((idea) => {
    if (
      idea.country !== data.countryCode ||
      idea.language !== data.languageCode ||
      !pages.has(auditedSeoPageKey(idea.url))
    )
      return [];
    const action = seasonalIdeaAction(idea);
    return action ? [{ idea, action }] : [];
  });
}
