import { hasSeasonalDemandRise } from "@sokosumi/utils";
import type { SeoReportPlanCandidate as Candidate } from "@/schemas/seo-report-plan.schema";
import {
  publicDecisionAction,
  readPublicSeoDecisions,
} from "./project-seo-decisions";
import type { PublicSeoPayload } from "./project-seo-report";
import { seasonalPayloadActions } from "./project-seo-seasonal";
import { auditedSeoPageKey } from "./project-seo-site-findings";
import { scopedAuditPlan } from "./seo-audit-plan";
import { scopedPageMarketEvidence } from "./seo-page-market-evidence";
import {
  reportPlanSignals,
  seasonalPlanFields,
} from "./seo-report-plan-signals";

const accessRules = new Set([
  "AC-01",
  "AC-03",
  "AC-05",
  "AC-06",
  "AC-15",
  "AC-16",
  "AC-20",
]);
const completionRules = new Set(["P-06", "P-10", "P-12", "P-22", "IL-08"]);
const severities = ["critical", "major", "minor"] as const;
const evidenceLimit = 3;
// Match the audit’s measured language-entry redirect. Both URL forms matter here.
function languageRedirect(evidence: string[]) {
  for (const line of evidence) {
    const match =
      /^(https?:\/\/\S+) redirects to the ([a-z-]+) homepage (https?:\/\/\S+); its declared ([a-z-]+) destination (https?:\/\/\S+) returns HTTP 200 in \4\.$/iu.exec(
        line,
      );
    if (!match) continue;
    const entry = URL.parse(match[1]!);
    const destination = URL.parse(match[5]!);
    if (
      match[2]!.toLowerCase() === match[4]!.toLowerCase() ||
      !entry ||
      !destination ||
      entry.origin !== destination.origin ||
      entry.pathname !== destination.pathname + "/"
    )
      continue;
    return {
      reason: `Visitors who open ${entry.pathname} land on the homepage in a different language. Send them to ${destination.pathname}, which already serves the correct language.`,
      nextCheck: `Open ${entry.pathname} and ${destination.pathname}. Both should end on ${destination.pathname} in the same language.`,
    };
  }
}
// The SEO worker investigates exact-page positions in this range (focus.ts).
const firstStrikingPosition = 4;
const lastStrikingPosition = 20;
const endOfMonth = (period: string) =>
  new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 0))
    .toISOString()
    .slice(0, 10);

/** Read each report before the workspace merges or retires repeated actions. */
export function scopedReportEvidence(
  data: PublicSeoPayload,
  selected: ReadonlySet<string>,
) {
  const inScope = (url: string) => selected.has(auditedSeoPageKey(url));
  const reportPages = new Set(data.pageUrls.map(auditedSeoPageKey));
  const reportPage = (url: string) =>
    inScope(url) && reportPages.has(auditedSeoPageKey(url));
  const brokenDestination = (line: string) => {
    const match = /^(https?:\/\/\S+) → (404|410)$/u.exec(line);
    if (!match || !URL.canParse(match[1]!) || !inScope(match[1]!)) return;
    return { url: auditedSeoPageKey(match[1]!), status: match[2]! };
  };
  const findings = new Map(data.findings.map((row) => [row.id, row]));
  const candidates: Candidate[] = [];
  for (const action of data.actions) {
    if (!reportPage(action.pageUrl)) continue;
    const cited = action.findingIds.flatMap((id) => {
      const row = findings.get(id);
      return row &&
        auditedSeoPageKey(row.pageUrl) === auditedSeoPageKey(action.pageUrl)
        ? [row]
        : [];
    });
    const severity = severities.find((level) =>
      cited.some((row) => row.severity === level),
    );
    if (!cited.length) continue;
    const rules = new Set(cited.map((row) => row.rowId));
    const links = cited
      .filter((row) => row.rowId === "IL-04")
      .flatMap((row) =>
        row.evidence.flatMap((line) => {
          const link = brokenDestination(line);
          return link ? [link.url] : [];
        }),
      );
    const kind = cited.some((row) => accessRules.has(row.rowId))
      ? "access"
      : cited.some((row) => completionRules.has(row.rowId))
        ? "completion"
        : rules.has("IL-04")
          ? "broken_link"
          : "repair";
    candidates.push({
      kind,
      pageUrl: action.pageUrl,
      actionId: action.id,
      title: action.title,
      reason: action.why,
      evidence: [...new Set(cited.flatMap((row) => row.evidence))].slice(
        0,
        evidenceLimit,
      ),
      nextCheck: `Repeat the page check for ${[...new Set(cited.map((row) => row.title))].slice(0, evidenceLimit).join(", ")}.`,
      severity,
      ...(rules.size === 1 &&
        rules.has("IN-07") &&
        languageRedirect(cited.flatMap((row) => row.evidence))),
      ...(links.length && { destinations: [...new Set(links)] }),
    });
  }
  // A broken destination can be reported as a note even when the worker produced no fix action.
  for (const finding of data.findings) {
    if (finding.rowId !== "IL-04" || !reportPage(finding.pageUrl)) continue;
    for (const line of finding.evidence) {
      const link = brokenDestination(line);
      if (!link) continue;
      const destination = link.url;
      if (
        candidates.some(
          (item) =>
            item.pageUrl === finding.pageUrl &&
            item.destinations?.includes(destination),
        )
      )
        continue;
      candidates.push({
        kind: "broken_link",
        pageUrl: finding.pageUrl,
        destinations: [destination],
        title: `Restore the link to ${new URL(destination).pathname} or point it to a working replacement.`,
        reason: `The audit followed this link and received HTTP ${link.status}.`,
        evidence: [line],
        nextCheck:
          "Follow the repaired link from the source page and complete the intended next step.",
      });
    }
  }
  for (const decision of readPublicSeoDecisions(
    data.strategyDecisions,
    data.pageUrls,
    data.decisionSources,
  ) ?? []) {
    if (
      !inScope(decision.targetUrl) ||
      ("observations" in decision &&
        !decision.observations.every((row) => inScope(row.url)))
    )
      continue;
    const action = publicDecisionAction(
      decision,
      data.countryCode,
      data.languageCode,
    );
    const kind =
      decision.kind === "open_strategy_opportunity"
        ? "experiment"
        : decision.kind === "internal_link_opportunity"
          ? "internal_link"
          : decision.kind === "offer_availability"
            ? "completion"
            : "content";
    candidates.push({
      kind,
      actionId: action.id,
      pageUrl: action.pageUrl,
      title: action.title,
      reason: action.why,
      ...(decision.kind === "content_opportunity" &&
        decision.reviewTrigger && {
          queries: [decision.reviewTrigger.keyword],
        }),
      alternative: decision.alternative,
      nextCheck: decision.nextCheck,
      evidence: action.evidence
        .filter((line) => !/^[a-f0-9]{64}$/u.test(line))
        .slice(0, evidenceLimit),
    });
  }
  const seasonalActions = seasonalPayloadActions(data);
  for (const { idea, action } of seasonalActions) {
    if (!reportPage(idea.url)) continue;
    const last = idea.windows
      .map((window) => window.targetPeriod)
      .sort()
      .at(-1);
    const end = last && endOfMonth(last);
    const through = idea.event?.date ?? end;
    candidates.push({
      kind: "content",
      pageUrl: idea.url,
      actionId: action.id,
      title: action.title,
      reason: action.why,
      evidence: [...new Set(action.evidence)].slice(0, evidenceLimit),
      nextCheck: action.expectedEffect,
      ...seasonalPlanFields(idea, through),
    });
  }
  const promoted = new Set(seasonalActions.map((row) => row.idea));
  for (const idea of data.seasonalIdeas ?? []) {
    if (
      promoted.has(idea) ||
      idea.contentPlan?.disposition === "keep" ||
      idea.marketBasis ||
      !reportPage(idea.url) ||
      idea.country !== data.countryCode ||
      idea.language !== data.languageCode
    )
      continue;
    const windows = idea.windows.filter(
      (w) =>
        idea.observedMonths?.some(
          (m) =>
            m.period === w.historicalPeriod && m.volume === w.historicalVolume,
        ) && hasSeasonalDemandRise(w.historicalVolume, w.baselineMedian),
    );
    const last = windows.at(-1);
    if (!last) continue;
    const queries =
      idea.contentPlan?.experiment?.targetQueries ?? idea.keywordIdeas ?? [];
    const evidence = windows.map(
      (w) =>
        `${w.historicalPeriod}: ${w.historicalVolume} estimated searches for “${idea.keyword}” against a median of ${w.baselineMedian}.`,
    );
    candidates.push({
      kind: "content",
      pageUrl: idea.url,
      title:
        idea.contentPlan?.nextStep ??
        `Draft a brief for “${idea.keyword}” for ${windows.map((w) => w.targetPeriod).join(", ")}.`,
      reason:
        idea.contentPlan?.experiment?.hypothesis ??
        `Earlier local demand suggests a window to test this topic. ${queries.length ? "Related searches to test: " + queries.join(", ") + "." : "Compare the query with the page’s existing answer before publishing."}`,
      evidence: [idea.pageQuote, ...evidence].slice(0, evidenceLimit),
      nextCheck: idea.contentPlan?.experiment?.successCheck,
      ...seasonalPlanFields(idea, endOfMonth(last.targetPeriod)),
    });
  }
  for (const row of data.keywords) {
    const angle = row.editorial?.angle;
    if (!reportPage(row.pageUrl)) continue;
    if (
      !angle &&
      data.kind === "rankings" &&
      row.device &&
      row.positionStatus === "ranked" &&
      row.position != null &&
      row.position >= firstStrikingPosition &&
      row.position <= lastStrikingPosition
    ) {
      candidates.push({
        kind: "content",
        pageUrl: row.pageUrl,
        queries: [row.keyword],
        title: `Test a clearer answer to “${row.keyword}” on the page already ranking for it.`,
        reason:
          "This page already reaches searchers for the term. Compare the task behind the query with the opening answer before commissioning another page.",
        evidence: [
          `The report found this page at position ${row.position} on ${row.device} for “${row.keyword}” in ${data.countryCode} (${data.languageCode}).`,
        ],
        alternative:
          "Keep the existing answer if it serves the task and compare how its search snippet describes it.",
        nextCheck: `Repeat the ${row.device} ranking check for this page and query, and compare relevant clicks if available.`,
      });
    }
    if (!angle && row.source === "gap" && row.volume && row.volume > 0) {
      candidates.push({
        kind: "experiment",
        pageUrl: row.pageUrl,
        queries: [row.keyword],
        title: `Check whether this page answers “${row.keyword}”.`,
        reason:
          "The audit found this query in competitor rankings. Compare the question their pages answer with the answer on this page.",
        evidence: [
          `“${row.keyword}” had an estimated ${row.volume} monthly searches in ${data.countryCode}.`,
        ],
        nextCheck:
          "Add the missing answer only if it fits the page. Then compare impressions and clicks for that query.",
      });
    }
    if (!angle || !row.volume || row.volume <= 0) continue;
    candidates.push({
      kind: "content",
      pageUrl: row.pageUrl,
      queries: [row.keyword],
      title: angle.nextStep,
      reason: `The report matched “${row.keyword}” to this page and measured demand for that search in ${data.countryCode}.`,
      evidence: [
        angle.quote,
        `“${row.keyword}” had an estimated ${row.volume} monthly searches.`,
      ],
    });
  }
  // Keep choices across pages and kinds without sending the full report with every observation.
  const groups = new Map<string, Candidate[]>();
  for (const item of candidates) {
    const key = JSON.stringify([
      item.pageUrl,
      item.kind,
      item.destinations ?? [],
      ...(item.queries?.length
        ? [item.queries[0].normalize("NFKC").trim().toLowerCase()]
        : []),
      ...(item.season ? [item.season.through] : []),
    ]);
    const group = groups.get(key) ?? [];
    if (!group.some((row) => row.title === item.title)) group.push(item);
    groups.set(key, group);
  }
  const rank = (item: Candidate) =>
    item.severity ? severities.indexOf(item.severity) : severities.length;
  const auditPlan = scopedAuditPlan(data.plan, reportPage);
  const planCandidates = [...groups.values()].flatMap((group) =>
    group.sort((a, b) => rank(a) - rank(b)),
  );
  return {
    ...scopedPageMarketEvidence(data, selected),
    planCandidates,
    planSignals: reportPlanSignals(data, reportPage),
    ...(auditPlan && { auditPlan }),
  };
}
