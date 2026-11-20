import type { ProjectSeoObservation } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoFoldSummary } from "./seo-shared";

type Research = NonNullable<
  ProjectSeoObservation["checklistBreakdown"]
>["research"][number];

export function SeoResearchDetails({
  firstScreen,
  trends,
}: Pick<Research, "firstScreen" | "trends">) {
  const t = useSeoResultTranslations("App.Seo");
  const signal = trends?.keywords.find(
    (row) =>
      row.status === "read" &&
      (row.trend === "rising" || row.trend === "falling"),
  );
  return (
    <>
      {firstScreen && (
        <details className="mt-2" lang="en">
          <SeoFoldSummary>
            {t("summary.researchDetails.visitor")}
          </SeoFoldSummary>
          <p className="mt-2 text-sm">
            {t(
              firstScreen.probe === "mobile_first_screen"
                ? "breakdown.devices.mobile"
                : "breakdown.devices.desktop",
            )}
            {" · "}
            {firstScreen.label}
            {" · "}
            {t(`summary.researchDetails.${firstScreen.state}`)}
          </p>
          <p className="text-muted-foreground text-sm">{firstScreen.reason}</p>
        </details>
      )}
      {signal && (signal.trend === "rising" || signal.trend === "falling") && (
        <p lang="en" className="mt-2 text-sm">
          {t(`keywords.planning.${signal.trend}`, { keyword: signal.keyword })}
        </p>
      )}
      {trends && trends.keywords.length > 0 && (
        <details className="mt-2" lang="en">
          <SeoFoldSummary>{t("summary.researchDetails.trends")}</SeoFoldSummary>
          <p className="my-2 text-sm text-muted-foreground">{trends.note}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                {t("summary.researchDetails.caption")}
              </caption>
              <thead>
                <tr>
                  {(
                    [
                      "keyword",
                      "status",
                      "peakMonths",
                      "seasonal",
                      "trend",
                      "change",
                      "evidence",
                    ] as const
                  ).map((heading) => (
                    <th key={heading} scope="col" className="p-2">
                      {t(`summary.researchDetails.${heading}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trends.keywords.map((row, index) => (
                  <tr key={row.keyword + index} className="border-t align-top">
                    <th scope="row" className="p-2 font-medium">
                      {row.keyword}
                    </th>
                    <td className="p-2">{row.status}</td>
                    <td className="p-2">
                      {row.peakMonths.join(", ") ||
                        t("summary.researchDetails.unknown")}
                    </td>
                    <td className="p-2">
                      {t(
                        row.seasonal === null
                          ? "summary.researchDetails.unknown"
                          : row.seasonal
                            ? "summary.researchDetails.yes"
                            : "summary.researchDetails.no",
                      )}
                    </td>
                    <td className="p-2">{row.trend}</td>
                    <td className="p-2">
                      {row.change ?? t("summary.researchDetails.unknown")}
                    </td>
                    <td className="p-2">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
