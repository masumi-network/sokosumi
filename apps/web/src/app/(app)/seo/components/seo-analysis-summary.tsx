"use client";

import { useLocale, useTranslations } from "next-intl";
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

/**
 * What the check will do, in one line: "Full audit · All 2 pages · United States · English". A value the
 * reader did not set is not said: both devices and no typed keyword are the defaults. The fields stay under
 * "Change options".
 */
export function SeoAnalysisSummary({
  kind,
  pages,
  scopeName,
  allPages,
  countryCode,
  languageCode,
  devices,
  keywords,
}: {
  kind: SeoAnalysisKind;
  pages: number;
  /** The name of a saved page group; null for all pages or a picked page, which the count says alone. */
  scopeName: string | null;
  /** Every page of the Audit: the line reads "All 2 pages", the words of the page picker. */
  allPages: boolean;
  countryCode: string;
  languageCode: string;
  devices: readonly SeoDevice[];
  /** The keyword field's text, or null for a check that reads no keyword. */
  keywords: string | null;
}) {
  const t = useTranslations("App.Seo");
  const locale = useLocale();
  const words = keywords === null ? [] : formLines(keywords);
  const parts = [
    t(`analysis.${kind}`),
    allPages
      ? t("allPagesCount", { count: pages })
      : [t("pages.count", { count: pages }), scopeName]
          .filter(Boolean)
          .join(" · "),
    seoMarketName(locale, countryCode, languageCode),
    devices.length === 1 ? t(`analysis.${devices[0]}`) : null,
    words.length > SHOWN_KEYWORDS
      ? t("analysis.summary.keywordCount", { count: words.length })
      : words.join(", ") || null,
  ].filter((part): part is string => Boolean(part));
  return (
    <p className="text-sm break-words" data-testid="seo-analysis-summary">
      {parts.map((part, index) => (
        // Static per render; two parts can share a text ("Desktop" as a keyword and a device).
        <span key={index}>
          {index ? <span className="text-muted-foreground"> · </span> : null}
          <span>{part}</span>
        </span>
      ))}
    </p>
  );
}
