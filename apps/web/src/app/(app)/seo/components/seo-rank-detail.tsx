"use client";

import { ArrowRight } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  type SeoRankDetail,
  type SeoRankResult,
  seoRankAbsentOthers,
  seoRankShownTop,
} from "./seo-rank-detail-model";
import { SeoDate, SeoFoldSummary } from "./seo-shared";

/** A region or language code in the reader's words, e.g. "DE" as "Germany"; the code when the browser has no name. */
function displayName(
  locale: string,
  type: "region" | "language",
  code: string,
) {
  try {
    return new Intl.DisplayNames([locale], { type }).of(code) ?? code;
  } catch {
    return code;
  }
}

function RankResult({ result }: { result: SeoRankResult }) {
  const t = useTranslations("App.Seo.overview.rank");
  const format = useFormatter();
  if (result.kind === "absent")
    return t("absent", { top: seoRankShownTop(result.top) });
  if (result.kind === "other") return result.text;
  if (result.kind === "searchConsole")
    return t("searchConsole", {
      position: format.number(result.position, { maximumFractionDigits: 1 }),
    });
  return t(result.featured ? "featuredSnippet" : "position", {
    position: result.position,
  });
}

/**
 * The "Organic position per device" measure as a short row: the lead keyword's result, its Market and day, the AI
 * Overview and the other keywords in one line. Every line the check wrote stays in a fold under it.
 */
export function SeoRankDetailRow({
  headingId,
  detail,
  evidence,
  onShowRankings,
}: {
  headingId: string;
  detail: SeoRankDetail;
  evidence: readonly string[];
  onShowRankings?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const locale = useLocale();
  const absentOthers = seoRankAbsentOthers(detail.others);
  // Each other keyword the page is not simply absent for gets its own line: a position, or what the read says.
  const listedOthers = detail.others.filter(
    (other) => other.result.kind !== "absent",
  );
  return (
    <div className="space-y-1">
      <p className="text-sm break-words">
        {/* The check's own name ("Organic position per device") stays in the fold's lines. */}
        <span id={headingId} className="font-medium">
          {t("overview.rank.title")}
        </span>
        <span className="text-muted-foreground">
          {" · "}
          {t(`analysis.${detail.device}`)}
        </span>
      </p>
      <p className="text-sm break-words">
        <span className="font-semibold">
          <RankResult result={detail.searchConsole ?? detail.result} />
        </span>{" "}
        <span className="text-muted-foreground">
          {t("overview.rank.forKeyword", { keyword: detail.keyword })}
        </span>
      </p>
      {/* Search Console leads with its average; the search result read today follows it. */}
      {detail.searchConsole ? (
        <p className="text-muted-foreground text-xs">
          {t("overview.rank.serpRead")} <RankResult result={detail.result} />
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {t("overview.rank.source", {
          country: displayName(locale, "region", detail.country),
          language: displayName(locale, "language", detail.language),
        })}
        {detail.readAt ? (
          <>
            {" · "}
            <SeoDate value={detail.readAt} day />
          </>
        ) : null}
      </p>
      {/* Only a citation is news to the owner: an AI Overview without the page gives nothing to act on here.
          That line stays in the fold. */}
      {detail.aiOverviewCites ? (
        <p className="text-xs">{t("overview.rank.aiCited")}</p>
      ) : null}
      {listedOthers.length || absentOthers ? (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {listedOthers.map((other) => (
            <li key={other.keyword} className="break-words">
              <span className="text-foreground font-medium">
                <RankResult result={other.result} />
              </span>{" "}
              {t("overview.rank.forKeyword", { keyword: other.keyword })}
            </li>
          ))}
          {absentOthers ? (
            <li>
              {t("overview.rank.othersAbsent", {
                count: absentOthers.count,
                top: seoRankShownTop(absentOthers.top),
              })}
            </li>
          ) : null}
        </ul>
      ) : null}
      {/* Every line the check wrote, for the reader who wants the source of the short form. */}
      <details className="text-muted-foreground text-xs">
        <SeoFoldSummary className="py-1.5">
          {t("overview.rank.allDetails")}
        </SeoFoldSummary>
        <ul className="list-disc space-y-0.5 ps-4 pt-1">
          {evidence.map((line, index) => (
            <li key={`${index}:${line}`} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      </details>
      {onShowRankings ? (
        <button
          type="button"
          aria-describedby={headingId}
          onClick={onShowRankings}
          className="focus-visible:ring-ring -my-2 inline-flex items-center gap-1 rounded-sm py-2 text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        >
          {t("overview.rank.showRankings")}
          <ArrowRight aria-hidden className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
