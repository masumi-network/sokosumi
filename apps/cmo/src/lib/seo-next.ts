import type { CmoSeo, CmoSeoSuggestion } from "@sokosumi/core-client";

export const NEXT_SHOWN = 3;

export type SeoStep =
  | { kind: "connect" }
  | { kind: "change"; item: CmoSeoSuggestion }
  | { kind: "article"; item: CmoSeoSuggestion };

/**
 * What the owner does next, most valuable first: connect Search Console when
 * it is not, the open page changes (each already has its text to copy), then
 * the articles still to write or publish.
 */
export function seoSteps(seo: CmoSeo): SeoStep[] {
  const steps: SeoStep[] = [];
  if (seo.searchConsole.status !== "connected") steps.push({ kind: "connect" });
  for (const item of seo.pageChanges)
    if (item.status === "open") steps.push({ kind: "change", item });
  for (const item of seo.articles)
    if (item.status === "open") steps.push({ kind: "article", item });
  return steps;
}

type Totals = NonNullable<CmoSeo["searchConsole"]["totals"]>;

/** "+12%" or "−8%" against the 28 days before; null when there is nothing to compare. */
export function changeText(now: number, before: number | undefined) {
  if (before === undefined || before === 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return "same as the 28 days before";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% on the 28 days before`;
}

/** Position: lower is better, so the words say which way it went. */
export function positionChangeText(
  now: number | null,
  before: number | null | undefined,
) {
  if (now === null || before === null || before === undefined) return null;
  const diff = Math.round((before - now) * 10) / 10;
  if (diff === 0) return "same as the 28 days before";
  return `${diff > 0 ? "up" : "down"} from ${before.toFixed(1)}`;
}

/** The lead's line: clicks against the 28 days before, when Google has both. */
export function trendLine(totals: Totals, previous: Totals | null): string {
  const change = previous ? changeText(totals.clicks, previous.clicks) : null;
  return change
    ? `In the last 28 days, ${change}.`
    : "In the last 28 days Google has settled.";
}
