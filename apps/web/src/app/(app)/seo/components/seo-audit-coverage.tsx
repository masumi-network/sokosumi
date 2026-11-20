import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoResearchDetails } from "./seo-research-details";
import { SeoDate, SeoFoldSummary } from "./seo-shared";

type Breakdown = NonNullable<
  ProjectSeoWorkspace["observations"][number]["checklistBreakdown"]
>;

export function SeoChecklistDetails({ data }: { data?: Breakdown | null }) {
  const t = useSeoResultTranslations("App.Seo");
  if (!data || data.passed === null || data.flagged === null)
    return (
      <details lang="en" className="mt-1">
        <SeoFoldSummary>{t("timeline.viewResults")}</SeoFoldSummary>
        <p className="mt-2">{t("summary.totalsOnly")}</p>
      </details>
    );
  const groups = Map.groupBy(data.gaps, (gap) => gap.reason);
  const pages = new Set(data.gaps.map((gap) => gap.pageUrl));
  return (
    <details lang="en" className="mt-1">
      <SeoFoldSummary>{t("timeline.viewResults")}</SeoFoldSummary>
      <p className="mt-2">
        {t("summary.verdictCounts", {
          passed: data.passed,
          flagged: data.flagged,
          missing: data.gaps.length,
        })}
      </p>
      {groups.size > 0 && (
        <ul className="mt-2 space-y-3">
          {Array.from(groups, ([reason, gaps]) => (
            <li key={reason}>
              <p className="break-words text-foreground">{reason}</p>
              {Array.from(
                Map.groupBy(gaps, (gap) => gap.pageUrl),
                ([url, rows]) => (
                  <p key={url} className="break-words">
                    {pages.size > 1 && <span className="block">{url}</span>}
                    {rows
                      .map(
                        (row) =>
                          row.rowId +
                          " (" +
                          t(`breakdown.devices.${row.device}`) +
                          ")",
                      )
                      .join(", ")}
                  </p>
                ),
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function SeoResearchStatus({
  data,
  observedAt,
}: {
  data: Breakdown["research"];
  observedAt: ProjectSeoWorkspace["observations"][number]["observedAt"];
}) {
  const t = useSeoResultTranslations("App.Seo");
  if (!data.length) return null;
  const showScope = data.length > 1;
  return (
    <section
      lang="en"
      aria-label={t("summary.researchTitle")}
      className="mt-3 min-w-0 space-y-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-semibold">{t("summary.researchTitle")}</h3>
        <span className="text-xs text-muted-foreground">
          <SeoDate report day value={observedAt} />
        </span>
      </div>
      {data.map(({ scope, pageUrl, stages, firstScreen, trends }) => (
        <div key={scope + pageUrl}>
          {showScope && (
            <p className="break-all text-xs text-muted-foreground">
              {scope === "site" ? t("summary.wholeSite") : pageUrl}
            </p>
          )}
          <dl className="space-y-1 text-sm">
            {stages.map((stage) => (
              <div
                key={stage.name}
                className="flex flex-wrap items-baseline gap-x-2"
              >
                <dt>{t(`summary.stage.${stage.name}`)}</dt>
                <dd className="text-muted-foreground">
                  {t(`summary.progress.${stage.status}`)}
                  {stage.reason && (
                    <span className="block">{stage.reason}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <SeoResearchDetails firstScreen={firstScreen} trends={trends} />
        </div>
      ))}
    </section>
  );
}
