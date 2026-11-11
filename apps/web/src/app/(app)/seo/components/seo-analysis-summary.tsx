"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  formLines,
  type SeoAnalysisKind,
  type SeoDevice,
} from "./seo-form-model";
import { seoMarketName } from "./seo-shared";

/** More keywords than this show as a count. */
const SHOWN_KEYWORDS = 3;

export type SeoAnalysisLimits =
  | { kind: "full"; usd: number; seconds: number }
  | { kind: "standard" }
  | { kind: "requests"; count: number }
  | { kind: "free" };

/** What the check will do with the chosen values, in one block. The fields stay under "Change options". */
export function SeoAnalysisSummary({
  kind,
  pages,
  scopeName,
  countryCode,
  languageCode,
  devices,
  keywords,
  limits,
}: {
  kind: SeoAnalysisKind;
  pages: number;
  scopeName: string;
  countryCode: string;
  languageCode: string;
  devices: readonly SeoDevice[];
  /** The keyword field's text, or null for a check that reads no keyword. */
  keywords: string | null;
  limits: SeoAnalysisLimits;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const locale = useLocale();
  const words = keywords === null ? null : formLines(keywords);
  const rows: [label: string, value: string][] = [
    [t("analysis.summary.check"), t(`analysis.${kind}`)],
    [
      t("analysis.summary.pages"),
      [t("pages.count", { count: pages }), scopeName]
        .filter(Boolean)
        .join(" · "),
    ],
    [
      t("analysis.summary.market"),
      [
        seoMarketName(locale, countryCode, languageCode),
        format.list(devices.map((device) => t(`analysis.${device}`))),
      ]
        .filter(Boolean)
        .join(" · "),
    ],
  ];
  if (words)
    rows.push([
      t("analysis.summary.keywords", { count: words.length }),
      words.length > SHOWN_KEYWORDS
        ? t("analysis.summary.keywordCount", { count: words.length })
        : words.join(", ") || t("analysis.summary.noKeyword"),
    ]);
  rows.push([
    t("analysis.summary.limits"),
    limits.kind === "full"
      ? t("analysis.summary.fullLimits", {
          usd: format.number(limits.usd, {
            style: "currency",
            currency: "USD",
          }),
          minutes: Math.round(limits.seconds / 60),
        })
      : limits.kind === "standard"
        ? t("analysis.standardPageLimits")
        : limits.kind === "requests"
          ? t("analysis.summary.requests", { count: limits.count })
          : t("analysis.summary.free"),
  ]);
  return (
    <dl
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm"
      data-testid="seo-analysis-summary"
    >
      {rows.map(([label, value]) => (
        <div className="contents" key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
