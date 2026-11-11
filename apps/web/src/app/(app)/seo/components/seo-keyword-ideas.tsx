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
import {
  SEO_IDEA_SOURCES,
  type SeoKeywordGroup,
} from "./seo-keyword-rows-model";
import {
  SEO_LIST_PAGE_SIZE,
  SEO_STACKED_TABLE_CLASS,
  SeoPageLink,
  SeoSection,
  SeoShowMore,
  seoMarketName,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Keywords a check found but read no position for: one row each, the most searched first. */
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
  const rows =
    expanded || model.keywordSearch
      ? ideas
      : ideas.slice(0, SEO_LIST_PAGE_SIZE);
  const shown = {
    volume: ideas.some((group) => group.volume !== null),
    intent: ideas.some((group) => group.intent !== null),
  };
  const manyPages = model.data.scope.pageIds.length > 1;
  // "Track" saves the row's market: with several, each row names its own.
  const manyMarkets =
    new Set(ideas.map(({ lead }) => `${lead.countryCode}:${lead.languageCode}`))
      .size > 1;
  return (
    <SeoSection
      title={t("keywords.ideas.title", { count: ideas.length })}
      description={t("keywords.ideas.help")}
    >
      <div className={HOLDER_ITEM_CLASS}>
        <Table className={SEO_STACKED_TABLE_CLASS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("keywords.keyword")}</TableHead>
              {shown.volume ? (
                <TableHead className="text-right">
                  {t("keywords.volume")}
                </TableHead>
              ) : null}
              {shown.intent ? (
                <TableHead>{t("keywords.intent")}</TableHead>
              ) : null}
              <TableHead>{t("keywords.ideas.why")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("queries.rowActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ lead, volume, intent, sources }) => (
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
                    <SeoPageLink url={lead.pageUrl} />
                  ) : null}
                </TableCell>
                {shown.volume ? (
                  <TableCell
                    className="text-right tabular-nums"
                    data-label={t("keywords.volume")}
                  >
                    {volume === null ? t("none") : format.number(volume)}
                  </TableCell>
                ) : null}
                {shown.intent ? (
                  <TableCell data-label={t("keywords.intent")}>
                    {intent ?? t("none")}
                  </TableCell>
                ) : null}
                <TableCell
                  className="whitespace-normal"
                  data-label={t("keywords.ideas.why")}
                >
                  {format.list(
                    SEO_IDEA_SOURCES.filter((source) =>
                      sources.includes(source),
                    ).map((source) => t(`keywords.ideas.source.${source}`)),
                  )}
                </TableCell>
                <TableCell>
                  {model.data.availableActions.canEdit ? (
                    <div className="flex justify-end max-sm:justify-start">
                      <Button
                        variant="outline"
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
      </div>
      {ideas.length > SEO_LIST_PAGE_SIZE && !model.keywordSearch ? (
        <SeoShowMore
          more={t("keywords.more", {
            count: ideas.length - SEO_LIST_PAGE_SIZE,
          })}
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
        />
      ) : null}
    </SeoSection>
  );
}
