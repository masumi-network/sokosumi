import { hasSeasonalDemandRise } from "@sokosumi/utils";
import type { z } from "zod";
import type { seoReportPlanSignal } from "@/schemas/seo-report-plan.schema";
import type { PublicSeoPayload } from "./project-seo-report";

type Idea = NonNullable<PublicSeoPayload["seasonalIdeas"]>[number];
type Signal = z.infer<typeof seoReportPlanSignal>;

function measuredWindows(idea: Idea) {
  const volumes = new Map(
    idea.observedMonths?.map((m) => [m.period, m.volume]),
  );
  return idea.windows.flatMap((w) => {
    if (idea.event && w.targetPeriod !== idea.event.date.slice(0, 7)) return [];
    if (
      volumes.get(w.historicalPeriod) !== w.historicalVolume ||
      !hasSeasonalDemandRise(w.historicalVolume, w.baselineMedian)
    )
      return [];
    const earlier = w.earlierCycle;
    const peaks = [w.historicalPeriod];
    if (
      earlier &&
      volumes.get(earlier.historicalPeriod) === earlier.historicalVolume &&
      hasSeasonalDemandRise(earlier.historicalVolume, earlier.baselineMedian)
    )
      peaks.unshift(earlier.historicalPeriod);
    return [{ month: w.targetPeriod, peaks }];
  });
}

export function seasonalPlanFields(idea: Idea, through?: string) {
  return {
    queries: [
      ...new Set([
        idea.keyword,
        ...(idea.contentPlan?.experiment?.targetQueries ??
          idea.keywordIdeas ??
          []),
      ]),
    ],
    ...(through && {
      season: {
        country: idea.country,
        through,
        windows: measuredWindows(idea),
        pageGap: idea.contentPlan?.disposition === "clarify",
      },
    }),
  };
}

/** Preserve distinct kinds of evidence, including from reports without an actionable edit. */
export function reportPlanSignals(
  data: PublicSeoPayload,
  inScope: (url: string) => boolean,
) {
  const signals = new Map<string, Signal>();
  function add(row: Signal) {
    const key = JSON.stringify([
      row.pageUrl,
      row.query.trim().normalize("NFKC").toLowerCase(),
      row.source,
    ]);
    if (!signals.has(key)) signals.set(key, row);
  }
  const topical = new Set(
    data.seasonalIdeas?.flatMap((idea) =>
      seasonalPlanFields(idea).queries.map((q) => q.toLowerCase()),
    ),
  );
  const keywords = data.keywords.toSorted(
    (a, b) =>
      Number(topical.has(b.keyword.toLowerCase())) -
        Number(topical.has(a.keyword.toLowerCase())) ||
      (b.volume ?? 0) - (a.volume ?? 0),
  );
  for (const row of keywords) {
    if (!inScope(row.pageUrl)) continue;
    const identity = { query: row.keyword, pageUrl: row.pageUrl };
    if (row.source === "gap")
      add({
        ...identity,
        source: "gap",
        evidence: `Competitor research identified “${row.keyword}” as a search gap for this page.`,
      });
    if (
      row.positionStatus === "ranked" &&
      row.position != null &&
      row.position > 0 &&
      row.device
    )
      add({
        ...identity,
        source: "rank",
        evidence: `This page ranked at position ${row.position} on ${row.device} for “${row.keyword}”.`,
      });
    if (row.editorial?.angle && row.volume && row.volume > 0)
      add({
        ...identity,
        source: "editorial",
        evidence: `For “${row.keyword}”, the report cites this passage: “${row.editorial.angle.quote}”.`,
      });
  }
  for (const idea of data.seasonalIdeas ?? []) {
    if (
      !inScope(idea.url) ||
      idea.marketBasis ||
      idea.country !== data.countryCode ||
      idea.language !== data.languageCode
    )
      continue;
    const windows = measuredWindows(idea);
    const peaks = windows.flatMap((w) => w.peaks);
    const identity = { pageUrl: idea.url, query: idea.keyword };
    if (idea.contentPlan?.disposition === "keep")
      add({
        ...identity,
        source: "covered",
        evidence: `The page review recommended keeping this answer: “${idea.contentPlan.passage}”.`,
      });
    if (!peaks.length) continue;
    add({
      ...identity,
      source: "season",
      peaks: [...new Set(peaks)],
      evidence: `For “${idea.keyword}”, measured local demand exceeded its comparison baseline in ${[...new Set(peaks)].sort().join(", ")}.`,
    });
    const flat = idea.trendComparison?.filter(
      (t) => !t.peak && peaks.includes(t.historicalPeriod),
    );
    if (flat?.length)
      add({
        ...identity,
        source: "trend_flat",
        evidence: `Google Trends did not confirm a peak in ${flat.map((t) => t.historicalPeriod).join(", ")} for “${idea.keyword}”.`,
      });
    const trends = idea.trendComparison?.filter(
      (t) => t.peak && peaks.includes(t.historicalPeriod),
    );
    if (trends?.length)
      add({
        ...identity,
        source: "trend",
        evidence: `Google Trends also showed a peak for “${idea.keyword}” in ${trends.map((t) => t.historicalPeriod).join(", ")}.`,
      });
  }
  // The report contains thousands of keyword rows. Send a shortlist per evidence type and page.
  const maxQueriesPerSource = 20;
  const counts = new Map<string, number>();
  return [...signals.values()].filter((row) => {
    const group = JSON.stringify([row.pageUrl, row.source]);
    const count = counts.get(group) ?? 0;
    counts.set(group, count + 1);
    return count < maxQueriesPerSource;
  });
}
