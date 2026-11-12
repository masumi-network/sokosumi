"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SeoConversionCell, SeoConversionNote } from "./seo-keyword-conversion";
import {
  SEO_IDEA_SOURCES,
  type SeoKeywordGroup,
} from "./seo-keyword-rows-model";
import {
  SEO_COMPACT_ROWS_CLASS,
  SeoBarNumber,
  SeoPageText,
  SeoSection,
  SeoShowMore,
  seoFoldCount,
  seoMarketName,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Keywords a check found but read no position for: one row each, a high or medium conversion estimate first, then the most searched. */
export function SeoKeywordIdeas({
  model,
  ideas,
}: {
  model: SeoWorkspaceModel;
  ideas: SeoKeywordGroup[];
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  if (!ideas.length) return null;
  // A search already narrows the list; it shows every match.
  const visible = seoFoldCount(ideas.length);
  const rows =
    expanded || model.keywordSearch ? ideas : ideas.slice(0, visible);
  const reasonsOf = (sources: string[]) =>
    SEO_IDEA_SOURCES.filter((source) => sources.includes(source));
  const shown = {
    volume: ideas.some((group) => group.volume !== null),
    // Only a check that estimates conversion fills the column.
    conversion: ideas.some((group) => group.conversion !== null),
    // One reason on every row in view tells no idea from another: "Related search" stood on ten of ten rows.
    why: new Set(rows.map(({ sources }) => reasonsOf(sources).join())).size > 1,
  };
  const manyPages = model.data.scope.pageIds.length > 1;
  // The bars set each idea against the most searched one of the list.
  const mostSearched = Math.max(0, ...ideas.map((group) => group.volume ?? 0));
  // "Track" saves the row's market: with several, each row names its own.
  const manyMarkets =
    new Set(ideas.map(({ lead }) => `${lead.countryCode}:${lead.languageCode}`))
      .size > 1;
  return (
    <SeoSection
      title={t("keywords.ideas.title", { count: ideas.length })}
      // The three lists of the switch start with a title of one size.
      strong
      // The one Track sentence: it names the next position check, so it has no place where none can run.
      // The Keywords list has none, because a check tracks its keywords from the start.
      description={
        model.data.availableActions.canEdit &&
        model.data.availableActions.canUsePaidSearchData === true
          ? t("keywords.help")
          : undefined
      }
    >
      <div className={HOLDER_ITEM_CLASS}>
        <Table className={SEO_COMPACT_ROWS_CLASS}>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t(manyPages ? "keywords.keywordAndPage" : "keywords.keyword")}
              </TableHead>
              {shown.volume ? (
                <TableHead className="text-right">
                  {t("keywords.volume")}
                </TableHead>
              ) : null}
              {shown.conversion ? (
                <TableHead>{t("keywords.conversion.title")}</TableHead>
              ) : null}
              {shown.why ? (
                <TableHead>{t("keywords.ideas.why")}</TableHead>
              ) : null}
              <TableHead>
                <span className="sr-only">{t("queries.rowActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ lead, volume, sources, conversion, feature }) => (
              <TableRow key={lead.id}>
                <TableCell className="min-w-48 whitespace-normal">
                  <p className="font-medium break-words">
                    <bdi>{lead.keyword}</bdi>
                  </p>
                  {manyMarkets ? (
                    <p className="text-muted-foreground text-xs">
                      {seoMarketName(
                        locale,
                        lead.countryCode,
                        lead.languageCode,
                      )}
                    </p>
                  ) : null}
                  {manyPages && lead.pageUrl ? (
                    <SeoPageText
                      url={lead.pageUrl}
                      workspace={model.data}
                      skipPrimary
                      oneLine
                    />
                  ) : null}
                </TableCell>
                {shown.volume ? (
                  <TableCell
                    className="text-right tabular-nums"
                    // No number, no unit: the label names the empty value.
                    data-label={
                      volume === null ? t("keywords.volume") : undefined
                    }
                  >
                    {volume === null ? (
                      <span className="text-muted-foreground">{t("none")}</span>
                    ) : (
                      <SeoBarNumber
                        value={volume}
                        max={mostSearched}
                        unit={t("keywords.volumeUnit", { count: volume })}
                      />
                    )}
                  </TableCell>
                ) : null}
                {shown.conversion ? (
                  <SeoConversionCell
                    conversion={conversion}
                    feature={feature}
                  />
                ) : null}
                {/* The reason is quieter than the keyword and its values. On a phone it follows the number or the estimate on one line. */}
                {shown.why ? (
                  <TableCell className="text-muted-foreground whitespace-normal">
                    {format.list(
                      reasonsOf(sources).map((source) =>
                        t(`keywords.ideas.source.${source}`),
                      ),
                    )}
                  </TableCell>
                ) : null}
                <TableCell>
                  {model.data.availableActions.canEdit ? (
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={model.pending}
                        onClick={() => {
                          void model.toggleKeyword(lead);
                        }}
                      >
                        {t("keywords.save")}
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {shown.conversion ? <SeoConversionNote /> : null}
      </div>
      {ideas.length > visible && !model.keywordSearch ? (
        <SeoShowMore
          more={t("keywords.ideas.more", {
            count: ideas.length - visible,
          })}
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
        />
      ) : null}
    </SeoSection>
  );
}
