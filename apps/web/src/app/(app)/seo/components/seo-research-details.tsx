import type { ProjectSeoObservation } from "@sokosumi/core-client";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { SeoFoldSummary } from "./seo-shared";

type Research = NonNullable<
  ProjectSeoObservation["checklistBreakdown"]
>["research"][number];

export function SeoResearchDetails({
  firstScreen,
  trends,
}: Pick<Research, "firstScreen" | "trends">) {
  const format = useSeoResultFormatter();
  const t = useSeoResultTranslations("App.Seo");
  return (
    <>
      {firstScreen && (
        <details className="border-t py-1" lang="en">
          <SeoFoldSummary className="min-h-10 text-sm font-medium">
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
      {trends && trends.keywords.length > 0 && (
        <details className="border-t py-1" lang="en">
          <SeoFoldSummary className="min-h-10 text-sm font-medium">
            {t("summary.researchDetails.trends")}
          </SeoFoldSummary>
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
                    {row.status !== "read" &&
                    !row.peakMonths.length &&
                    row.seasonal === null &&
                    row.change === null &&
                    row.trend === "not determined" ? (
                      <td colSpan={6} className="p-2 text-muted-foreground">
                        {row.note}
                      </td>
                    ) : (
                      <>
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
                          {row.change == null
                            ? t("summary.researchDetails.unknown")
                            : format.number(row.change - 1, {
                                style: "percent",
                                maximumFractionDigits: 0,
                                signDisplay: "exceptZero",
                              })}
                        </td>
                        <td className="p-2">{row.note}</td>
                      </>
                    )}
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
