"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import {
  type SeoShareRow,
  seoShareOfVoiceCard,
} from "./seo-share-of-voice-model";
import { SeoFoldSummary, SeoSection } from "./seo-shared";

/** Smallest bar a share above zero draws, so it stays visible. */
const MIN_BAR_PERCENT = 2;

/**
 * The site's and the confirmed competitors' estimated share of organic clicks in the newest week with SERP reads.
 * An estimate from a click-through rate per rank: the card says so.
 */
export function SeoShareOfVoice({
  shareOfVoice,
}: {
  shareOfVoice: ProjectSeoWorkspace["shareOfVoice"];
}) {
  const t = useTranslations("App.Seo.shareOfVoice");
  const format = useFormatter();
  const card = seoShareOfVoiceCard(shareOfVoice);
  if (!card) return null;
  const week = (value: string) =>
    format.dateTime(new Date(`${value}T12:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  const percent = (share: number) =>
    format.number(share, { style: "percent", maximumFractionDigits: 1 });
  const name = (row: SeoShareRow) =>
    row.kind === "competitor" ? (row.domain ?? "") : t(row.kind);
  return (
    <SeoSection
      title={t("title")}
      description={t("description", {
        week: week(card.weekStart),
        count: card.reads,
      })}
    >
      <ul className="space-y-2 px-2">
        {card.rows.map((row) => (
          <li
            key={`${row.kind}:${row.domain ?? ""}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm"
          >
            <span
              className={
                row.kind === "site" ? "font-medium" : "text-muted-foreground"
              }
            >
              <bdi className="break-words">{name(row)}</bdi>
            </span>
            <span className="text-right tabular-nums">
              {percent(row.share)}
              {row.change !== null && card.previousWeek ? (
                <span className="text-muted-foreground ms-2 text-xs">
                  {t("change", {
                    points: format.number(row.change * 100, {
                      maximumFractionDigits: 1,
                      signDisplay: "exceptZero",
                    }),
                  })}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden
              className="bg-quaternary col-span-2 block h-1 rounded-full"
            >
              <span
                className={
                  row.kind === "site"
                    ? "bg-foreground block h-1 rounded-full"
                    : "bg-chart-5 block h-1 rounded-full"
                }
                style={{
                  width: `${row.share > 0 ? Math.max(MIN_BAR_PERCENT, row.share * 100) : 0}%`,
                }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground px-2 text-xs">
        {card.previousWeek
          ? `${t("changeNote", { week: week(card.previousWeek) })} `
          : null}
        {t("method")}
      </p>
      {card.siteWeeks.length > 1 ? (
        <details className="px-2 text-sm">
          <SeoFoldSummary className="text-muted-foreground py-2 text-xs">
            {t("weekly")}
          </SeoFoldSummary>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th scope="col" className="py-1 font-normal">
                    {t("week")}
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    {t("siteShare")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {card.siteWeeks.map((row) => (
                  <tr key={row.weekStart} className="border-t">
                    <td className="py-1">{week(row.weekStart)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {percent(row.share)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </SeoSection>
  );
}
