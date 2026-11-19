import type { ProjectSeoAction } from "@sokosumi/core-client";

import { seoResultFormat } from "@/i18n/seo-result-messages";

const day = (value: Date) =>
  seoResultFormat.dateTime(new Date(value), { dateStyle: "medium" });
export function seoFollowUpText(
  review: NonNullable<ProjectSeoAction["followUpReview"]>,
  t: IntlTranslation<"App.Seo">,
) {
  const values = {
    keyword: review.keyword,
    before: review.before,
    after: review.after,
    prior: day(review.baselineObservedAt),
    date: day(review.observedAt),
  };
  return review.kind === "rank_crosses"
    ? t("actions.rankReview", values)
    : t("actions.demandReview", {
        ...values,
        month: review.period
          ? seoResultFormat.dateTime(
              new Date(review.period + "-01T00:00:00Z"),
              { month: "long", year: "numeric" },
            )
          : "",
      });
}
