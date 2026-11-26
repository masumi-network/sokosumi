"use client";

import type { ProjectSeoActionImpact } from "@sokosumi/core-client";
import { SEO_IMPACT_MIN_COUNT } from "@sokosumi/utils";
import { seoResultFormat } from "@/i18n/seo-result-messages";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import {
  type SeoActionImpactRow,
  seoActionImpactModel,
} from "./seo-action-impact-model";
import { SeoPeriod } from "./seo-shared";

/**
 * A done action in Search Console: the same number of days before and after it, for its page alone. The words
 * under the figures say what the comparison leaves open, so two numbers do not read as cause and effect.
 */
export function SeoActionImpact({
  impact,
}: {
  impact: ProjectSeoActionImpact;
}) {
  const t = useSeoResultTranslations("App.Seo.actions.impact");
  const { rows, readableFrom } = seoActionImpactModel(impact);
  const day = (value: string) =>
    seoResultFormat.dateTime(new Date(`${value}T12:00:00Z`), {
      dateStyle: "medium",
    });
  const figure = (
    row: SeoActionImpactRow,
    side: "before" | "after",
  ): string => {
    const value = row[side];
    if (value !== null)
      return seoResultFormat.number(
        value,
        row.metric === "position"
          ? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
          : undefined,
      );
    // A read window without impressions has no position. That is a result, not a missing read.
    if (impact[side]) return t("noPosition");
    return side === "after" && impact.state === "too_early"
      ? t("pending")
      : t("notMeasured");
  };
  return (
    <section lang="en" className="space-y-1.5">
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-muted-foreground">
        {t(impact.anchorKind, { date: day(impact.anchor) })}
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-start text-xs tabular-nums">
          <thead>
            <tr className="border-b">
              <th scope="col" className="sr-only">
                {t("metric")}
              </th>
              {(["before", "after"] as const).map((side) => (
                <th
                  key={side}
                  scope="col"
                  className="px-3 py-2 text-start font-medium"
                >
                  {t(`${side}Days`, { days: impact.days })}
                  {impact[side] && (
                    <span className="text-muted-foreground block font-normal">
                      <SeoPeriod
                        report
                        from={impact[side].from}
                        to={impact[side].to}
                      />
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.metric}>
                <th
                  scope="row"
                  className="text-muted-foreground px-3 py-2 text-start font-normal"
                >
                  {t(row.metric)}
                </th>
                <td className="px-3 py-2">{figure(row, "before")}</td>
                <td className="px-3 py-2">
                  {figure(row, "after")}
                  {row.percent !== null && (
                    <span className="text-muted-foreground">
                      {" "}
                      (
                      {seoResultFormat.number(row.percent / 100, {
                        style: "percent",
                        signDisplay: "exceptZero",
                      })}
                      )
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {impact.state === "too_early" && (
        <p>{t("tooEarly", { days: impact.days, date: day(readableFrom) })}</p>
      )}
      {impact.state === "not_measured" && <p>{t("notMeasuredNote")}</p>}
      {impact.state === "low_counts" && (
        <p>{t("lowCounts", { min: SEO_IMPACT_MIN_COUNT })}</p>
      )}
      <p className="text-muted-foreground">{t("caveat")}</p>
    </section>
  );
}
