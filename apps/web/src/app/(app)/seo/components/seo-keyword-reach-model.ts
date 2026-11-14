import type { ProjectSeoStrategy } from "@sokosumi/core-client";

import { SEO_STRATEGY_REACHES, seoStrategyKey } from "./seo-strategy-model";

type RivalHost = NonNullable<ProjectSeoStrategy["rivalKeywords"]>[number];
type RivalRow = RivalHost["rows"][number];

/** A list of a competing product shows this many rows; the site Report of the audit holds every row. */
export const SEO_RIVAL_ROWS_SHOWN = 10;

/**
 * A competing product's keywords: the rows with a topic word of the site first, the other rows apart. A host with
 * other products ranks for their keywords too (SEO bot B211). Without topic words every row is a topic row.
 */
export function seoRivalLists(host: RivalHost): {
  topic: RivalRow[];
  other: RivalRow[];
  /** Rows of each list past SEO_RIVAL_ROWS_SHOWN. */
  topicMore: number;
  otherMore: number;
} {
  const marked = host.topicWords.length > 0;
  const topic = host.rows.filter((row) => !marked || row.topic);
  const other = marked ? host.rows.filter((row) => !row.topic) : [];
  return {
    topic: topic.slice(0, SEO_RIVAL_ROWS_SHOWN),
    other: other.slice(0, SEO_RIVAL_ROWS_SHOWN),
    topicMore: Math.max(0, topic.length - SEO_RIVAL_ROWS_SHOWN),
    otherMore: Math.max(0, other.length - SEO_RIVAL_ROWS_SHOWN),
  };
}

/**
 * The searches of a feature's best search: the overview read's number, and the suggestions read's when it differs
 * (SEO bot B210: 50 in the suggestions, 30 in the overview). No overview number: the suggestions read's alone.
 */
export function seoFeatureSearches(row: {
  volume: number;
  demand: number | null;
}): { searches: number; suggested: number | null } {
  if (row.demand === null) return { searches: row.volume, suggested: null };
  return {
    searches: row.demand,
    suggested: row.demand === row.volume ? null : row.volume,
  };
}

/** The message key of a reach word of the SEO bot; null for a word it has no key for (the word shows as it is). */
export const seoReachKey = (reach: string) =>
  seoStrategyKey(SEO_STRATEGY_REACHES, reach);
