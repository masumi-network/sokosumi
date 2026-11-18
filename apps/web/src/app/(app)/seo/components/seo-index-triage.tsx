"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
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

const utcDay = (value: string | Date) =>
  new Date(value).toISOString().slice(0, 10);

/**
 * The agent's review note of one page in the Google index list: what it could verify, then the next step.
 * Non-issue notes complement the audit findings. Under the page's Google status the note leaves out its state
 * unless the page's notes differ in state, and Google's reason and last crawl, which the status line already gives;
 * alone, it names its page and gives them itself.
 */
export function SeoIndexNote({
  assessment,
  alone,
  badge = false,
  statusReadAt,
}: {
  assessment: IndexAssessment;
  /** No Google status stands over the note: it names its page, its state and Google's own words. */
  alone: boolean;
  /** Notes of the page differ in state: each note carries its own, as the verdict line cannot pair them. */
  badge?: boolean;
  /** When Google's status over the note was read. */
  statusReadAt?: string | Date | null;
}) {
  const t = useTranslations("App.Seo.indexReview");
  const google = seoIndexEvidence(assessment.evidence);
  // Google's status was read on a later day than the review: the day says the note may describe an older result.
  // Calendar days in UTC: a sync seconds after the review comes from another writer and is not a newer result.
  const older =
    statusReadAt != null && utcDay(assessment.checkedAt) < utcDay(statusReadAt);
  return (
    <div className="space-y-2 text-sm">
      {alone || badge || older ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {alone || badge ? (
            <SeoState>{t(`state.${assessment.status}`)}</SeoState>
          ) : null}
          {alone ? <SeoPageLink url={assessment.pageUrl} /> : null}
          {older ? (
            <span className="text-muted-foreground text-xs">
              {t("checked")} <SeoDate value={assessment.checkedAt} day />
            </span>
          ) : null}
        </div>
      ) : null}
      {assessment.auditPageUrl &&
      assessment.auditPageUrl !== assessment.pageUrl ? (
        <p className="text-muted-foreground text-xs">
          {t("auditPage")} <SeoPageLink url={assessment.auditPageUrl} quiet />
        </p>
      ) : null}
      {/* The next step follows the reason. An expected exclusion needs nothing, so it stays quiet. */}
      <p
        className={cn(
          "break-words",
          assessment.status === "expected_exclusion" && "text-muted-foreground",
        )}
      >
        <span>{assessment.reason}</span>
        {assessment.suggestedFix ? (
          <>
            {" "}
            <span>{assessment.suggestedFix}</span>
          </>
        ) : null}
      </p>
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
