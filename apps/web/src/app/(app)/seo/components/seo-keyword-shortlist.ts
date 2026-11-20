import { seoClickGain } from "./seo-keyword-map-model";
import { MEDIUM_DIFFICULTY_FROM } from "./seo-keyword-recommendations";
import type { SeoKeywordGroup } from "./seo-keyword-rows-model";

type Reason =
  | "priority"
  | "fitUnknown"
  | "medium"
  | "low"
  | "difficultyUnknown"
  | "competition"
  | "gainUnknown"
  | "noGain"
  | "smallerGain"
  | "smallerLift";
export type IdeaAssessment = {
  reason: Reason;
  extra: number | null;
  lift: number | null;
  order: number;
  medianExtra: number;
};

function estimate(group: SeoKeywordGroup) {
  const extra = seoClickGain(group.clicks)?.top10 ?? null;
  const lift =
    extra !== null && group.clicks && group.clicks.now > 0
      ? extra / group.clicks.now
      : null;
  return { extra, lift };
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length
    ? (sorted[mid] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2
    : 0;
}

/** Compare against the whole market, so typing into the filter never improves an idea's standing. */
export function assessKeywordIdeas(
  ideas: SeoKeywordGroup[],
  reference = ideas,
) {
  const market = ({ lead }: SeoKeywordGroup) =>
    JSON.stringify([lead.countryCode, lead.languageCode]);
  const thresholds = new Map(
    [...Map.groupBy(reference, market)].map(([key, rows]) => {
      const gains = rows.map(estimate);
      return [
        key,
        {
          extra: median(
            gains.flatMap(({ extra }) => (extra !== null ? [extra] : [])),
          ),
          lift: median(
            gains.flatMap(({ lift }) => (lift !== null ? [lift] : [])),
          ),
        },
      ];
    }),
  );
  const assessments = new Map<string, IdeaAssessment>();
  for (const [order, idea] of ideas.entries()) {
    const { extra, lift } = estimate(idea);
    const threshold = thresholds.get(market(idea));
    let reason: Reason = "priority";
    if (!idea.conversion) reason = "fitUnknown";
    else if (idea.conversion !== "high") reason = idea.conversion;
    else if (idea.difficulty === null) reason = "difficultyUnknown";
    else if (idea.difficulty >= MEDIUM_DIFFICULTY_FROM) reason = "competition";
    else if (extra === null) reason = "gainUnknown";
    else if (extra === 0) reason = "noGain";
    else if (threshold && extra < threshold.extra) reason = "smallerGain";
    else if (threshold && lift !== null && lift < threshold.lift)
      reason = "smallerLift";
    assessments.set(idea.lead.id, {
      reason,
      extra,
      lift,
      order,
      medianExtra: threshold?.extra ?? 0,
    });
  }
  return assessments;
}

export function priorityFirst(a?: IdeaAssessment, b?: IdeaAssessment) {
  const priority =
    Number(b?.reason === "priority") - Number(a?.reason === "priority");
  if (priority || !a || !b) return priority;
  return (
    (b.extra ?? -1) - (a.extra ?? -1) ||
    (b.lift ?? 0) - (a.lift ?? 0) ||
    a.order - b.order
  );
}
