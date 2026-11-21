import { OPEN_STRATEGY } from "@/schemas/project-seo-action.schema";
import type { ResearchCoverage } from "@/schemas/seo-audit-coverage.schema";
import {
  seoFirstScreen,
  seoKeywordTrends,
} from "@/schemas/seo-research-details.schema";
import { reportObject } from "./project-seo-public-report";
import type { PublicSeoPayload } from "./project-seo-report";

type Stage = ResearchCoverage["stages"][number];

const explorationReasons: Record<string, string> = {
  published: "The exploration published a new recommendation.",
  no_admitted_finding: "The audit found no new recommendation.",
  publication_checks: "The idea did not pass the final checks.",
  owner_evidence_requested: "This check requires private evidence.",
  deadline: "The audit reached its time limit.",
  insufficient_public_evidence: "There was too little usable public evidence.",
  comparison_unavailable: "The audit could not complete the comparison.",
  disabled: "This audit did not enable free exploration.",
  owner_decision_present:
    "The audit already contains a decision from private evidence.",
  capture_failed: "The exploration could not finish.",
  missing_receipt: "This report has no saved exploration result.",
  unverified_evidence: "The exploration evidence could not be verified.",
};
const editorReasons: Record<string, string> = {
  market: "The audit could not check keywords for this market.",
  public_copy: "There was too little page text to suggest keywords.",
  budget: "The remaining budget could not cover another keyword check.",
  credential: "The keyword data connection was unavailable.",
  deadline: "The audit reached its time limit.",
  unavailable: "Keyword validation was unavailable.",
  model_failure: "An editor could not complete its review.",
  no_candidates: "There were no new search terms to check.",
  unrecorded: "No result was saved for this check.",
};

function exploration(report: Record<string, unknown>): Stage {
  const receipt = reportObject(report.explorationStatus);
  const status = receipt?.status;
  const reason =
    typeof receipt?.reason === "string" &&
    Object.hasOwn(explorationReasons, receipt.reason)
      ? explorationReasons[receipt.reason]
      : undefined;
  return {
    name: "exploration",
    status:
      status === "ran"
        ? receipt?.reason === "deadline" ||
          receipt?.reason === "owner_evidence_requested"
          ? "partial"
          : "completed"
        : status === "no_novel_finding"
          ? "no_finding"
          : status === "skipped"
            ? "skipped"
            : "unknown",
    ...(reason && { reason }),
  };
}

function seasonal(report: Record<string, unknown>): Stage {
  const receipt = reportObject(reportObject(report.seasonalReview)?.status);
  const reviewers = [receipt?.demand, receipt?.audience];
  const status = reviewers.every((s) => s === "completed")
    ? "completed"
    : reviewers.includes("completed")
      ? "partial"
      : reviewers.every((s) => s === "not_requested")
        ? "skipped"
        : "unknown";
  const failed = reviewers.some((s) => s === "invalid" || s === "failed");
  return {
    name: "seasonal",
    status,
    ...(failed && {
      reason: "Part of the seasonal check returned no usable result.",
    }),
  };
}

function editorial(report: Record<string, unknown>): Stage {
  const opportunities = reportObject(report.keywordOpportunities);
  const receipt = reportObject(opportunities?.editorialResearch);
  const state = receipt?.status;
  const reason =
    typeof receipt?.reason === "string" &&
    Object.hasOwn(editorReasons, receipt.reason)
      ? editorReasons[receipt.reason]
      : undefined;
  if (state === "complete" || state === "partial" || state === "skipped")
    return {
      name: "editorial",
      status: state === "complete" ? "completed" : state,
      ...(reason && { reason }),
    };
  const ideas = opportunities?.list;
  if (Array.isArray(ideas) && ideas.some((row) => reportObject(row)?.editorial))
    return {
      name: "editorial",
      status: "unknown",
      reason: "Some keyword research was saved. The final result is unknown.",
    };
  // This worker variant admitted editors only when the regular list had fewer than 20 rows.
  const legacyEditorsVariant =
    "f2e3d750c2c077d12d4760a01c0e34f954c32f12854cbe5f607de1240ba2a710";
  if (
    report.variant === legacyEditorsVariant &&
    Array.isArray(ideas) &&
    ideas.length === 20
  )
    return {
      name: "editorial",
      status: "skipped",
      reason: "The regular keyword list had already filled all 20 places.",
    };
  return { name: "editorial", status: "unknown" };
}

export function pageResearchCoverage(
  raw: unknown,
  pageUrl: string,
): ResearchCoverage {
  const report = reportObject(raw) ?? {};
  const firstScreen = seoFirstScreen.safeParse(report.strategyInvestigation);
  const trends = seoKeywordTrends.safeParse(report.trends);
  return {
    ...(firstScreen.success && { firstScreen: firstScreen.data }),
    ...(trends.success && { trends: trends.data }),
    pageUrl,
    scope: "page",
    stages: [seasonal(report), editorial(report), exploration(report)],
  };
}

export function siteResearchCoverage(
  raw: unknown,
  pageUrl: string,
  pages: ResearchCoverage[],
): ResearchCoverage[] {
  const report = reportObject(raw) ?? {};
  const result = pages.map((page) => ({
    ...page,
    stages: page.stages.filter((row) => row.name !== "exploration"),
  }));
  return [...result, { pageUrl, scope: "site", stages: [exploration(report)] }];
}

/** Historical payloads retained ideas and decisions, but did not retain the reviewer receipts. */
export function retainedResearchCoverage(
  data: PublicSeoPayload,
): ResearchCoverage[] {
  if (data.kind !== "audit_full") return [];
  const site = data.pageUrls.length > 1 || data.strategy !== undefined;
  const exploration: Stage = {
    name: "exploration",
    status: data.strategyDecisions?.some((d) => d.kind === OPEN_STRATEGY)
      ? "completed"
      : "unknown",
  };
  const pages: ResearchCoverage[] = data.pageUrls.map((pageUrl) => {
    const seasonal: Stage = { name: "seasonal", status: "unknown" };
    if (
      data.seasonalIdeas?.some(
        (idea) => idea.url === pageUrl && idea.origin !== "market_history",
      )
    )
      seasonal.reason =
        "The report retained a seasonal reviewer’s idea. The full stage outcome was not recorded.";
    else if (
      data.pageUrls.length === 1 &&
      data.notes.includes(
        "Seasonal keyword research: The captured page could not be used as public evidence for seasonal keyword research.",
      )
    ) {
      seasonal.status = "skipped";
      seasonal.reason =
        "The seasonal reviewers lacked eligible public page text.";
    }
    const editorial: Stage = { name: "editorial", status: "unknown" };
    if (
      data.keywords.some(
        (row) => row.pageUrl === pageUrl && row.editorial?.models.length,
      )
    )
      editorial.reason =
        "Some keyword research was saved. The final result is unknown.";
    return {
      scope: "page",
      pageUrl,
      stages: site ? [seasonal, editorial] : [seasonal, editorial, exploration],
    };
  });
  if (site)
    pages.push({
      scope: "site",
      pageUrl: data.pageUrls[0]!,
      stages: [exploration],
    });
  return pages;
}
