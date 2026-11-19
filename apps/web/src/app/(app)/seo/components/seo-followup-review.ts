import type { ProjectSeoAction } from "@sokosumi/core-client";

import { seoResultFormat } from "@/i18n/seo-result-messages";

const day = (value: Date) =>
  seoResultFormat.dateTime(new Date(value), { dateStyle: "medium" });
export function seoFollowUpText(
  review: NonNullable<ProjectSeoAction["followUpReview"]>,
  t: IntlTranslation<"App.Seo">,
) {
  if ("beforePeriod" in review) {
    const values = {
      before: review.before,
      after: review.after,
      from: day(review.beforePeriod.from),
      to: day(review.beforePeriod.to),
      sessions: review.beforePeriod.sessions,
      laterFrom: day(review.afterPeriod.from),
      laterTo: day(review.afterPeriod.to),
      laterSessions: review.afterPeriod.sessions,
    };
    const label =
      review.kind === "engagement_changed"
        ? "actions.engagementReview"
        : review.kind === "purchase_rate_changed"
          ? "actions.purchaseReview"
          : "actions.signupReview";
    return t(label, values);
  }
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
