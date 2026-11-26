import type { SeoKeywordGroup } from "./seo-keyword-rows-model";

type Keyword = SeoKeywordGroup["rows"][number];
const MAX_SUPPORTING_QUERIES = 2;

/** Keep the offer, market and competitor evidence together in a single audit. Input is in editorial priority order. */
export function contentPlanningIdeas(groups: SeoKeywordGroup[]) {
  const candidates = groups.flatMap((group) => {
    const latest = group.rows.find((row) => row.observationId);
    if (!latest) return [];
    const rows = group.rows.filter(
      (row) => row.observationId === latest.observationId,
    );
    const idea = rows.find(
      (row) =>
        row.source === "opportunity" &&
        row.pageUrl &&
        row.volume !== null &&
        row.volume > 0 &&
        (row.editorial?.angle ||
          (row.feature &&
            (row.conversion === "medium" || row.conversion === "high"))),
    );
    return idea
      ? [{ idea, gap: rows.some((row) => row.source === "gap") }]
      : [];
  });
  const plans: { idea: Keyword; gap: boolean; related: string[] }[] = [];
  for (const gap of [true, false]) {
    const lead = candidates.find((c) => c.gap === gap);
    if (!lead) continue;
    const row = lead.idea;
    const related = candidates.filter(
      (c) =>
        c !== lead &&
        c.gap === gap &&
        row.feature &&
        row.intent &&
        c.idea.intent === row.intent &&
        c.idea.feature === row.feature &&
        c.idea.pageUrl === row.pageUrl &&
        c.idea.observationId === row.observationId &&
        c.idea.countryCode === row.countryCode &&
        c.idea.languageCode === row.languageCode,
    );
    plans.push({
      ...lead,
      related: related
        .slice(0, MAX_SUPPORTING_QUERIES)
        .map((c) => c.idea.keyword),
    });
  }
  return plans;
}
