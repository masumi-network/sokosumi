"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { seoIndexTriage } from "./seo-index-triage-model";
import { SeoDate, SeoFoldSummary, SeoPageLink, SeoSection } from "./seo-shared";

/** Non-issue review notes complement the audit findings and Google's own status readout. */
export function SeoIndexTriage({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useTranslations("App.Seo.indexReview");
  const triage = seoIndexTriage(workspace);
  if (!triage) return null;
  return (
    <SeoSection title={t("title")} description={t("help")}>
      <ul className={cn(HOLDER_ITEM_CLASS, "divide-y")}>
        {triage.assessments.map((assessment) => (
          <li
            key={JSON.stringify([
              assessment.auditPageUrl ?? assessment.pageUrl,
              assessment.pageUrl,
            ])}
            className="space-y-3 p-4 text-sm"
          >
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-medium">
                <CircleHelp
                  aria-hidden
                  className="text-muted-foreground size-4 shrink-0"
                />
                {t(`state.${assessment.status}`)}
              </h3>
              <SeoPageLink url={assessment.pageUrl} />
              <p className="text-muted-foreground text-xs">
                {t("checked")} <SeoDate value={assessment.checkedAt} />
              </p>
            </div>
            <p className="break-words">{assessment.reason}</p>
            {assessment.suggestedFix ? (
              <div className="space-y-1">
                <p className="font-medium">{t("suggestedFix")}</p>
                <p className="text-muted-foreground break-words">
                  {assessment.suggestedFix}
                </p>
              </div>
            ) : null}
            {assessment.evidence.length ? (
              <details className="text-muted-foreground">
                <SeoFoldSummary>{t("evidence")}</SeoFoldSummary>
                <div className="space-y-2 pt-2">
                  <p>
                    {t(
                      assessment.status === "unavailable"
                        ? "unavailableEvidence"
                        : "sources",
                    )}
                  </p>
                  <ul className="list-disc space-y-1 ps-4">
                    {assessment.evidence.map((line, index) => (
                      <li key={`${index}:${line}`} className="break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </SeoSection>
  );
}
