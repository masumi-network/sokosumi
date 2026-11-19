"use client";

import { ArrowRight } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {/* The check's own name ("Organic position per device") stays in the fold's lines. */}
          <span id={headingId} className="font-semibold">
            {t("overview.rank.title")}
          </span>
          <span className="sr-only"> · </span>
          <Badge
            variant="outline"
            className="text-muted-foreground font-normal"
          >
            {t(`analysis.${detail.device}`)}
          </Badge>
        </p>
        {/* The result is the news, so it is the largest text; the keyword under it says what it is for. */}
        <p className="text-sm break-words">
          <span className="block text-lg leading-snug font-semibold tracking-tight">
            <RankResult result={detail.searchConsole ?? detail.result} />
          </span>{" "}
          <span className="text-muted-foreground">
            {t.rich("overview.rank.forKeyword", {
              keyword: detail.keyword,
              k: (chunks) => (
                <span className="text-foreground font-medium">{chunks}</span>
              ),
            })}
          </span>
        </p>
        {/* Search Console leads with its average; the search result read today follows it. */}
        {detail.searchConsole ? (
          <p className="text-muted-foreground text-xs">
            {t("overview.rank.serpRead")}{" "}
            <span className="text-foreground font-medium">
              <RankResult result={detail.result} />
            </span>
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          <span>
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
          </span>
        </p>
        {/* Only a citation is news to the owner: an AI Overview without the page gives nothing to act on here.
            That line stays in the fold. */}
        {detail.aiOverviewCites ? (
          <p className="text-xs font-medium">{t("overview.rank.aiCited")}</p>
        ) : null}
      </div>
      {listedOthers.length || absentOthers ? (
        <div className="bg-muted space-y-2 rounded-md px-3 py-2.5">
          {/* Without a listed keyword the one line already says "other keywords". */}
          {listedOthers.length ? (
            <p className="text-muted-foreground text-xs font-medium">
              {t("overview.rank.otherKeywords")}
            </p>
          ) : null}
          <ul className="space-y-1.5 text-xs">
            {listedOthers.map((other) => (
              <li
                key={other.keyword}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
              >
                {/* Under the "Other keywords" label the keyword stands alone; its result follows. */}
                <span className="min-w-0 break-words">{other.keyword}</span>
                <span className="sr-only">: </span>
                <span className="text-foreground font-medium tabular-nums">
                  <RankResult result={other.result} />
                </span>
              </li>
            ))}
            {absentOthers ? (
              <li className="text-muted-foreground">
                {t("overview.rank.othersAbsent", {
                  count: absentOthers.count,
                  top: seoRankShownTop(absentOthers.top),
                })}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <div className="space-y-2">
        {/* Every line the check wrote, for the reader who wants the source of the short form. */}
        <details className="text-muted-foreground text-xs">
          <SeoFoldSummary className="w-fit py-1.5 font-medium">
            {t("overview.rank.allDetails")}
          </SeoFoldSummary>
          <ul className="border-border mt-2 divide-y divide-border rounded-md border text-xs leading-relaxed">
            {evidence.map((line, index) => (
              <li key={`${index}:${line}`} className="px-3 py-2 break-words">
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
            className="focus-visible:ring-ring text-foreground inline-flex items-center gap-1 -my-2 rounded-sm py-2 text-xs font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          >
            {t("overview.rank.showRankings")}
            <ArrowRight aria-hidden className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
