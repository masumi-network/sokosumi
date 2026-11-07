import { createHash } from "node:crypto";

import type { z } from "@hono/zod-openapi";

import type {
  ProjectSeoWorkspace,
  seoSearchQueryRowSchema,
} from "@/schemas/project-seo.schema";

type SearchRow = z.infer<typeof seoSearchQueryRowSchema>;
export type SeoSearchOpportunity = Omit<
  ProjectSeoWorkspace["actions"][number],
  "observationId" | "taskId" | "status"
>;
export interface SearchOpportunitySource {
  propertyId: string;
  from: string;
  to: string;
  rows: SearchRow[];
}

/**
 * Named review heuristics over measured Search Console rows. These thresholds are
 * product choices for prioritising a review. They are not Google standards and
 * they do not prove a problem or predict traffic.
 */
export const SEO_OPPORTUNITY_RULES = {
  snippetReview: {
    id: "snippet_review",
    name: "snippet review",
    minImpressions: 5,
    maxAveragePosition: 5,
    maxCtr: 0.02,
  },
  strikingDistance: {
    id: "striking_distance",
    name: "striking distance",
    minImpressions: 5,
    minAveragePosition: 4,
    maxAveragePosition: 20,
  },
} as const;
export const SEO_OPPORTUNITY_LIMIT = 10;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const position = (value: number) => value.toFixed(1);

/** One ID per query and page: a later sync that matches another rule keeps the same Task. */
function opportunityId(row: SearchRow): string {
  return `gsc:query:${createHash("sha256")
    .update(JSON.stringify([row.query, row.pageUrl]))
    .digest("hex")
    .slice(0, 16)}`;
}

function measured(row: SearchRow, source: SearchOpportunitySource): string[] {
  return [
    `Query: ${row.query}`,
    `Page: ${row.pageUrl}`,
    `Search Console ${source.propertyId}, ${source.from} to ${source.to}`,
    `${row.clicks} clicks, ${row.impressions} impressions, click-through rate ${percent(row.ctr)}, average position ${position(row.averagePosition)}`,
  ];
}

function snippetReview(
  row: SearchRow,
  source: SearchOpportunitySource,
): SeoSearchOpportunity | null {
  const rule = SEO_OPPORTUNITY_RULES.snippetReview;
  if (
    row.impressions < rule.minImpressions ||
    row.averagePosition > rule.maxAveragePosition ||
    row.ctr > rule.maxCtr
  )
    return null;
  return {
    id: opportunityId(row),
    kind: "opportunity",
    pageUrl: row.pageUrl,
    findingIds: [],
    title: `Review the search snippet for "${row.query}"`,
    why: `This page has average position ${position(row.averagePosition)} for this query, but a click-through rate of ${percent(row.ctr)} (${row.clicks} clicks from ${row.impressions} impressions). It matches the "${rule.name}" heuristic: average position ${rule.maxAveragePosition} or better, at least ${rule.minImpressions} impressions and a click-through rate of ${percent(rule.maxCtr)} or less. This is a review suggestion, not a confirmed problem.`,
    effort: "low",
    expectedEffect:
      "Hypothesis: a title and meta description that answer this query more directly can raise the click-through rate. Google can rewrite snippets. Compare the next Search Console period; no traffic change is promised.",
    edit: null,
    evidence: [...measured(row, source), `Heuristic: ${rule.name}`],
  };
}

function strikingDistance(
  row: SearchRow,
  source: SearchOpportunitySource,
): SeoSearchOpportunity | null {
  const rule = SEO_OPPORTUNITY_RULES.strikingDistance;
  if (
    row.impressions < rule.minImpressions ||
    row.averagePosition < rule.minAveragePosition ||
    row.averagePosition > rule.maxAveragePosition
  )
    return null;
  return {
    id: opportunityId(row),
    kind: "opportunity",
    pageUrl: row.pageUrl,
    findingIds: [],
    title: `Strengthen the page for "${row.query}"`,
    why: `This page has average position ${position(row.averagePosition)} for this query from ${row.impressions} impressions and ${row.clicks} clicks. It matches the "${rule.name}" heuristic: average position ${rule.minAveragePosition} to ${rule.maxAveragePosition} with at least ${rule.minImpressions} impressions. Average position is a Search Console mean, not a live rank. This is a review suggestion, not a confirmed problem.`,
    effort: "medium",
    expectedEffect:
      "Hypothesis: clearer coverage of this query in the page text, headings and internal links can improve its average position. Compare the next Search Console period; no traffic change is promised.",
    edit: null,
    evidence: [...measured(row, source), `Heuristic: ${rule.name}`],
  };
}

/** Deterministic: the same stored rows always give the same IDs, so Task links stay stable. */
export function searchOpportunities(
  source: SearchOpportunitySource,
): SeoSearchOpportunity[] {
  return [...source.rows]
    .sort(
      (a, b) =>
        b.impressions - a.impressions ||
        a.query.localeCompare(b.query) ||
        a.pageUrl.localeCompare(b.pageUrl),
    )
    .flatMap((row) => {
      const match = snippetReview(row, source) ?? strikingDistance(row, source);
      return match ? [match] : [];
    })
    .slice(0, SEO_OPPORTUNITY_LIMIT);
}
