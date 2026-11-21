import type { ProjectSeoObservation } from "@sokosumi/database";
import { hasSeasonalDemandRise } from "@sokosumi/utils";
import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import {
  type ReviewSource,
  searchTerm,
  uniqueRank,
} from "@/helpers/seo-recommendation-evidence";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import type { PublicSeoDecision } from "@/schemas/project-seo-action.schema";

export type AuditScope = Pick<
  ProjectSeoObservation,
  "id" | "projectId" | "auditId" | "ownerId" | "scopeVersion" | "observedAt"
> & { continuousSince?: Date | null };
type Idea = NonNullable<PublicSeoPayload["seasonalIdeas"]>[number];
type Review = NonNullable<
  ProjectSeoWorkspace["actions"][number]["followUpReview"]
>;
type Measurement = {
  row: AuditScope;
  source: ReviewSource;
  ideas: Idea[];
  inPeriod: boolean;
};

function seasonalPeriods(idea: Idea) {
  if (
    idea.event &&
    idea.comparison?.status === "above_baseline" &&
    idea.comparison.baselineMedian !== null
  ) {
    const event = new Date(idea.event.date + "T00:00:00Z"),
      lead = new Date(
        Date.UTC(event.getUTCFullYear(), event.getUTCMonth() - 1, 1),
      );
    const comparison = idea.comparison;
    return [comparison.leadMonth, comparison.eventMonth].flatMap((month, i) =>
      month?.volume != null &&
      idea.observedMonths?.some(
        (row) => row.period === month.period && row.volume === month.volume,
      ) &&
      hasSeasonalDemandRise(month.volume, comparison.baselineMedian!)
        ? [
            {
              period:
                i === 0
                  ? lead.toISOString().slice(0, 7)
                  : idea.event!.date.slice(0, 7),
              baseline: comparison.baselineMedian!,
            },
          ]
        : [],
    );
  }
  return idea.windows.flatMap((w) =>
    w.targetPeriod ===
      String(Number(w.historicalPeriod.slice(0, 4)) + 1) +
        w.historicalPeriod.slice(4) &&
    idea.observedMonths?.some(
      (row) =>
        row.period === w.historicalPeriod && row.volume === w.historicalVolume,
    ) &&
    hasSeasonalDemandRise(w.historicalVolume, w.baselineMedian)
      ? [{ period: w.targetPeriod, baseline: w.baselineMedian }]
      : [],
  );
}
/** Carry confirmed evidence past audits that did not measure this keyword. The workspace bounds and scopes the immutable observation history. */
export class SeoRecommendationFollowups {
  private readonly measurements = new Map<string, Measurement[]>();
  compare(
    row: AuditScope,
    data: Pick<
      PublicSeoPayload,
      | "reviewSources"
      | "seasonalIdeas"
      | "countryCode"
      | "languageCode"
      | "rulebookVersion"
    >,
    url: string,
    inPeriod: boolean,
    now: Date,
  ) {
    const candidates = (data.reviewSources ?? []).filter(
      (s) =>
        s.url === url &&
        s.country === data.countryCode &&
        s.language === data.languageCode &&
        s.rulebook === data.rulebookVersion,
    );
    if (candidates.length !== 1 || row.observedAt > now) return;
    const source = candidates[0];
    if (Date.parse(source.at) > now.getTime()) return;
    const key = JSON.stringify([
      row.projectId,
      row.auditId,
      row.ownerId,
      row.scopeVersion,
      url,
      source.country,
      source.language,
      source.rulebook,
    ]);
    const measurements = this.measurements.get(key) ?? [];
    const later = measurements
      .filter(
        (m) =>
          m.row.observedAt > row.observedAt &&
          m.row.id !== row.id &&
          m.source.snapshotId !== source.snapshotId &&
          m.source.at.slice(0, 10) > source.at.slice(0, 10),
      )
      .sort((a, b) => Date.parse(b.source.at) - Date.parse(a.source.at));
    measurements.push({
      inPeriod,
      row,
      source,
      ideas: (data.seasonalIdeas ?? []).filter(
        (i) =>
          i.url === url &&
          i.country === source.country &&
          i.language === source.language &&
          i.asOf === source.at.slice(0, 10) &&
          !i.marketBasis,
      ),
    });
    this.measurements.set(key, measurements);
    if (!later.length) return;
    const cut =
      row.continuousSince && row.observedAt <= row.continuousSince
        ? row.continuousSince
        : null;
    const baseline = {
      baselineObservationId: row.id,
      baselineObservedAt: source.at,
    };
    return {
      rank(d: PublicSeoDecision): Review | undefined {
        if (
          d.kind !== "content_opportunity" ||
          !d.reviewTrigger ||
          !d.evidence.includes(source.snapshotId) ||
          !d.evidence.includes("rankingData.page.ranked")
        )
          return;
        const t = d.reviewTrigger,
          before = uniqueRank(source, t.keyword);
        if (before !== t.position) return;
        let firstCrossing: Measurement | undefined,
          crossedRank: number | undefined;
        let confirmedStart = !cut;
        for (const m of later) {
          const after = uniqueRank(m.source, t.keyword);
          if (after === undefined) continue;
          if (after === null || before <= t.boundary === after <= t.boundary) {
            if (after !== null && cut && m.row.observedAt > cut)
              confirmedStart = true;
            break;
          }
          firstCrossing = m;
          crossedRank = after;
        }
        if (
          confirmedStart &&
          firstCrossing?.inPeriod &&
          crossedRank !== undefined
        )
          return {
            ...baseline,
            observationId: firstCrossing.row.id,
            observedAt: firstCrossing.source.at,
            kind: "rank_crosses",
            before,
            after: crossedRank,
            keyword: t.keyword,
          };
      },
      demand(idea: Idea): Review | undefined {
        if (idea.marketBasis || idea.asOf !== source.at.slice(0, 10)) return;
        const targets = seasonalPeriods(idea).filter(
          (t) => t.period >= idea.asOf.slice(0, 7),
        );
        const term = searchTerm(idea.keyword),
          candidates: Review[] = [];
        for (const target of targets) {
          if (cut && target.period < cut.toISOString().slice(0, 7)) continue;
          let latestChecked = false,
            firstRise: Measurement | undefined,
            volume: number | undefined;
          for (const m of later) {
            if (target.period >= m.source.at.slice(0, 7)) continue;
            const histories = m.ideas
              .filter((i) => searchTerm(i.keyword) === term)
              .map((i) => i.observedMonths ?? []);
            if (m.source.demand && searchTerm(m.source.demand.keyword) === term)
              histories.push(m.source.demand.months);
            const values = new Set(
              histories.flatMap((h) =>
                h
                  .filter((r) => r.period === target.period)
                  .map((r) => r.volume),
              ),
            );
            if (!values.size) continue;
            const amount = [...values][0],
              rises =
                values.size === 1 &&
                hasSeasonalDemandRise(amount, target.baseline);
            if (!latestChecked && !rises) break;
            latestChecked = true;
            if (rises) {
              firstRise = m;
              volume = amount;
            }
          }
          if (firstRise?.inPeriod && volume !== undefined)
            candidates.push({
              ...baseline,
              observationId: firstRise.row.id,
              observedAt: firstRise.source.at,
              kind: "demand_returns",
              before: target.baseline,
              after: volume,
              period: target.period,
              keyword: idea.keyword,
            });
        }
        return candidates.sort((a, b) =>
          b.observedAt.localeCompare(a.observedAt),
        )[0];
      },
    };
  }
}
