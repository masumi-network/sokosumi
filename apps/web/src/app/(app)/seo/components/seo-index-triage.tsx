"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { seoIndexEvidence } from "./seo-index-triage-model";
import {
  SeoDate,
  SeoFoldSummary,
  SeoMetaLine,
  SeoPageLink,
  SeoState,
} from "./seo-shared";

type IndexAssessment = NonNullable<
  ProjectSeoWorkspace["indexTriage"]
>["assessments"][number];

/**
 * The agent's review note of one page in the Google index list: its state, what it could verify and the next step.
 * Non-issue notes complement the audit findings. Under the page's Google status the note leaves out Google's
 * reason and last crawl, which the status already gives; alone, it names its page and gives them itself.
 */
export function SeoIndexNote({
  assessment,
  alone,
}: {
  assessment: IndexAssessment;
  /** No Google status stands over the note: it names its page and Google's own words. */
  alone: boolean;
}) {
  const t = useTranslations("App.Seo.indexReview");
  const google = seoIndexEvidence(assessment.evidence);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SeoState>{t(`state.${assessment.status}`)}</SeoState>
        <span className="text-muted-foreground text-xs">
          {t("checked")} <SeoDate value={assessment.checkedAt} />
        </span>
      </div>
      {alone ? <SeoPageLink url={assessment.pageUrl} /> : null}
      <p className="break-words">{assessment.reason}</p>
      {assessment.suggestedFix ? (
        <div className="space-y-1">
          <p className="font-medium">{t("suggestedFix")}</p>
          <p className="text-muted-foreground break-words">
            {assessment.suggestedFix}
          </p>
        </div>
      ) : null}
      {/* Google's own words for the page and when it last looked: a result older than a fix says why it differs. */}
      {alone ? (
        <SeoMetaLine
          className="text-xs"
          items={[
            [
              "reason",
              google.reason
                ? t("googleReason", { reason: google.reason })
                : null,
            ],
            [
              "crawled",
              google.crawledAt ? (
                <>
                  {t("lastCrawled")} <SeoDate value={google.crawledAt} day />
                </>
              ) : null,
            ],
          ]}
        />
      ) : null}
      {/* The lines that say more than the reason: a state that is not fine, a robots.txt line. */}
      {google.more.length ? (
        <details className="text-muted-foreground">
          <SeoFoldSummary>{t("evidence")}</SeoFoldSummary>
          <ul className="list-disc space-y-1 ps-4 pt-2">
            {google.more.map((line, index) => (
              <li key={`${index}:${line}`} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
