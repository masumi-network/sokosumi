import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoSeasonalTiming } from "@sokosumi/utils";

type Report = ProjectSeoWorkspace["observations"][number];
type Candidate = NonNullable<Report["planCandidates"]>[number];
type Signal = NonNullable<Report["planSignals"]>[number];
type Citation = {
  reportId: string;
  evidence: string;
  source: Signal["source"];
};
const key = (query: string) =>
  query.trim().normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
const sameTopic = (item: Candidate, row: Signal) =>
  item.pageUrl === row.pageUrl &&
  item.queries?.some((query) => key(query) === key(row.query));

export function earlierPlanReports(data: ProjectSeoWorkspace, report: Report) {
  const time = +new Date(report.observedAt);
  return data.observations
    .filter(
      (row) =>
        row.planCandidates !== undefined &&
        +new Date(row.observedAt) < time &&
        row.id !== report.id &&
        row.artifactHash !== report.artifactHash &&
        !!report.countryCode &&
        !!report.languageCode &&
        row.countryCode === report.countryCode &&
        row.languageCode === report.languageCode &&
        row.pageIds.some(
          (id) =>
            report.pageIds.includes(id) && data.scope.pageIds.includes(id),
        ),
    )
    .toSorted(
      (a, b) =>
        +new Date(b.observedAt) - +new Date(a.observedAt) ||
        a.id.localeCompare(b.id),
    );
}

/** A repeated import, or a later report about another language or page, cannot verify a hypothesis. */
export function reportHypotheses(
  data: ProjectSeoWorkspace,
  report: Report,
  asOf: Date,
) {
  const history = earlierPlanReports(data, report);
  const currentSignals = report.planSignals ?? [];
  const scoped = new Set(
    data.pages
      .filter(
        (p) =>
          report.pageIds.includes(p.id) && data.scope.pageIds.includes(p.id),
      )
      .map((p) => p.url),
  );
  const previousSignals = new Map<string, Map<Signal["source"], Citation>>();
  const signalKey = (url: string, query: string) =>
    JSON.stringify([url, key(query)]);
  for (const previous of history)
    for (const row of previous.planSignals ?? []) {
      if (!scoped.has(row.pageUrl)) continue;
      const id = signalKey(row.pageUrl, row.query);
      const sources = previousSignals.get(id) ?? new Map();
      if (!sources.has(row.source))
        sources.set(row.source, {
          reportId: previous.id,
          evidence: row.evidence,
          source: row.source,
        });
      previousSignals.set(id, sources);
    }
  const pastSeasons = new Map<string, Map<string, Citation>>();
  for (const prior of history)
    for (const signal of prior.planSignals ?? []) {
      if (signal.source !== "season" || !scoped.has(signal.pageUrl)) continue;
      const id = signalKey(signal.pageUrl, signal.query);
      const peaks = pastSeasons.get(id) ?? new Map<string, Citation>();
      for (const period of signal.peaks ?? [])
        if (!peaks.has(period))
          peaks.set(period, {
            reportId: prior.id,
            source: "season",
            evidence: signal.evidence,
          });
      pastSeasons.set(id, peaks);
    }
  const origin = new Map<Candidate, Report>();
  const candidates = [...(report.planCandidates ?? [])];
  // A new rank or gap report can revive an earlier content brief for the same query.
  for (const prior of history)
    for (const item of prior.planCandidates ?? []) {
      const earlierAngle = prior.planSignals?.some(
        (s) => s.source === "editorial" && sameTopic(item, s),
      );
      if (
        (!item.season && !earlierAngle) ||
        !scoped.has(item.pageUrl) ||
        item.queries?.some((query) => {
          const covered = previousSignals
            .get(signalKey(item.pageUrl, query))
            ?.get("covered");
          return (
            covered &&
            history.find(
              (r) =>
                r.id === covered.reportId &&
                +new Date(r.observedAt) >= +new Date(prior.observedAt),
            )
          );
        }) ||
        !currentSignals.some(
          (s) =>
            ["rank", "gap", "editorial", "trend"].includes(s.source) &&
            sameTopic(item, s),
        ) ||
        currentSignals.some(
          (s) => s.source === "covered" && sameTopic(item, s),
        ) ||
        (item.season &&
          seoSeasonalTiming(
            {
              country: item.season.country,
              event: { date: item.season.through },
              windows: [],
            },
            asOf,
          ).passed) ||
        candidates.some(
          (other) =>
            !!other.season === !!item.season &&
            other.pageUrl === item.pageUrl &&
            other.queries?.[0] &&
            key(other.queries[0]) === key(item.queries?.[0] ?? ""),
        )
      )
        continue;
      origin.set(item, prior);
      candidates.push(item);
    }
  function assess(item: Candidate) {
    const sources: Citation[] = [];
    if (scoped.has(item.pageUrl))
      for (const q of item.queries ?? []) {
        for (const cited of previousSignals
          .get(signalKey(item.pageUrl, q))
          ?.values() ?? []) {
          if (!sources.some((s) => s.source === cited.source))
            sources.push(cited);
        }
      }
    const prior = origin.get(item);
    const current = currentSignals.filter((s) => sameTopic(item, s));
    if (prior) {
      sources.push({
        reportId: prior.id,
        source: item.season ? "season" : "editorial",
        evidence: item.reason,
      });
      sources.push(
        ...current.map((s) => ({
          source: s.source,
          reportId: report.id,
          evidence: s.evidence,
        })),
      );
    }
    const season = item.season;
    const today =
      season &&
      seoSeasonalTiming(
        {
          country: season.country,
          event: { date: season.through },
          windows: [],
        },
        asOf,
      );
    const window =
      today && !today.passed
        ? season?.windows
            ?.filter((w) => w.month >= today.currentMonth)
            .toSorted((a, b) => a.month.localeCompare(b.month))[0]
        : undefined;
    const month = window?.month;
    const prep = month && new Date(month + "-01T12:00:00Z");
    if (prep) prep.setUTCMonth(prep.getUTCMonth() - 1);
    const prepare = prep ? prep.toISOString().slice(0, 7) : undefined;
    const independent = sources.some((s) =>
      ["gap", "rank", "editorial", "trend"].includes(s.source),
    );
    const gap =
      season?.pageGap ||
      [...sources, ...current].some((s) => s.source === "gap");
    const peaks = new Set(window?.peaks);
    if (window && item.queries?.[0]) {
      const targetYear = Number(window.month.slice(0, 4));
      for (const [period, citation] of pastSeasons.get(
        signalKey(item.pageUrl, item.queries[0]),
      ) ?? []) {
        const yearsBack = targetYear - Number(period.slice(0, 4));
        if (
          yearsBack < 1 ||
          yearsBack > 3 ||
          period.slice(5) !== window.month.slice(5) ||
          peaks.has(period)
        )
          continue;
        peaks.add(period);
        if (
          !sources.some(
            (s) =>
              s.reportId === citation.reportId &&
              s.evidence === citation.evidence,
          )
        )
          sources.push(citation);
      }
    }
    const repeated = peaks.size > 1;
    const due = !!(today && prepare && prepare <= today.currentMonth);
    const timing =
      window && prepare
        ? {
            month: window.month,
            peaks: [...peaks].sort(),
            prepare,
            due,
            repeated,
            gap,
          }
        : undefined;
    // A seasonal forecast on its own does not outrank a measured evergreen opportunity.
    const covered =
      current.some((s) => s.source === "covered") ||
      (!season?.pageGap && sources.some((s) => s.source === "covered"));
    const contradicts = [...sources, ...current].some(
      (s) => s.source === "trend_flat",
    );
    const strength =
      covered || contradicts
        ? 0
        : timing && repeated && gap && due
          ? 3
          : timing && repeated && gap
            ? 2
            : independent && (season || sources.some((s) => s.source === "gap"))
              ? 1
              : 0;
    const corroboration =
      sources.length && independent && !covered && !contradicts
        ? season
          ? ("season" as const)
          : [...sources, ...current].some((s) => s.source === "gap")
            ? ("gap" as const)
            : undefined
        : undefined;
    return {
      sources,
      timing,
      strength,
      corroboration,
      originId: prior?.id ?? report.id,
    };
  }
  return { candidates, assess, origin };
}
