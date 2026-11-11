"use client";

import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  SEO_LIST_PAGE_SIZE,
  SEO_SEARCH_MIN_ROWS,
  SEO_STACKED_TABLE_CLASS,
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoSection,
  SeoShowMore,
  SeoSource,
  SeoState,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoCompetitors({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  // The reader's own page and the competitors they chose lead, so a row they
  // just added never hides behind "Show more". The sort keeps Core's order within each part.
  const part = (row: (typeof model.filteredCompetitors)[number]) =>
    row.role === "page" ? 0 : row.confirmed ? 1 : 2;
  const all = model.filteredCompetitors.toSorted(
    (left, right) => part(left) - part(right),
  );
  const [expanded, setExpanded] = useState(false);
  // A search already narrows the list; it shows every match.
  const rows =
    expanded || model.competitorSearch ? all : all.slice(0, SEO_LIST_PAGE_SIZE);
  const number = (value: number | null) =>
    value === null ? t("none") : format.number(value);
  // A column no row has measured only repeats "Not available"; name it once instead.
  const shown = {
    rank: all.some((row) => row.rank !== null),
    backlinks: all.some((row) => row.backlinks !== null),
    domains: all.some((row) => row.referringDomains !== null),
    observed: all.some((row) => row.observedAt !== null),
    source: all.some((row) => row.observationId || row.source !== "saved"),
  };
  const hidden = [
    shown.rank ? null : t("competitors.rank"),
    shown.backlinks ? null : t("competitors.backlinks"),
    shown.domains ? null : t("competitors.domains"),
    shown.observed ? null : t("observed"),
  ].filter((label): label is string => label !== null);
  const paidOff = model.data.availableActions.canUsePaidSearchData !== true;
  // A confirmed competitor is the default row; only the other states need a badge.
  const state = (row: (typeof rows)[number]) =>
    row.role === "page"
      ? "competitors.yourPage"
      : row.confirmed
        ? null
        : "competitors.suggested";
  return (
    <SeoSection
      title={t("competitors.title")}
      description={t("competitors.help")}
      actions={
        model.data.availableActions.canEdit ? (
          <Button size="sm" onClick={() => model.setDialog("competitor")}>
            <Plus className="size-4" />
            {t("competitors.add")}
          </Button>
        ) : null
      }
    >
      {model.data.competitors.length >= SEO_SEARCH_MIN_ROWS ||
      model.competitorSearch ? (
        <div className="px-2 pb-3">
          <Label htmlFor="seo-competitor-search" className="sr-only">
            {t("search")}
          </Label>
          <Input
            id="seo-competitor-search"
            type="search"
            value={model.competitorSearch}
            onChange={(event) => model.setCompetitorSearch(event.target.value)}
            placeholder={t("search")}
          />
        </div>
      ) : null}
      {rows.length ? (
        <div className={HOLDER_ITEM_CLASS}>
          <Table className={SEO_STACKED_TABLE_CLASS}>
            {/* A lone "Page URL" header names what every row already shows. */}
            <TableHeader
              className={cn(
                !(
                  shown.rank ||
                  shown.backlinks ||
                  shown.domains ||
                  shown.observed ||
                  shown.source
                ) && "sr-only",
              )}
            >
              <TableRow>
                <TableHead>{t("url")}</TableHead>
                {shown.rank ? (
                  <TableHead className="text-right">
                    {t("competitors.rank")}
                  </TableHead>
                ) : null}
                {shown.backlinks ? (
                  <TableHead className="text-right">
                    {t("competitors.backlinks")}
                  </TableHead>
                ) : null}
                {shown.domains ? (
                  <TableHead className="text-right">
                    {t("competitors.domains")}
                  </TableHead>
                ) : null}
                {shown.observed ? <TableHead>{t("observed")}</TableHead> : null}
                {shown.source ? <TableHead>{t("source")}</TableHead> : null}
                <TableHead>
                  <span className="sr-only">{t("manage")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const compare =
                  row.role === "competitor" && Boolean(model.data.auditId);
                const toggle =
                  model.data.availableActions.canEdit &&
                  row.role === "competitor" &&
                  (row.canConfirm || row.confirmed);
                const badge = state(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-56 whitespace-normal">
                      <SeoPageLink url={row.url} />
                      {badge ? (
                        <div className="mt-1">
                          <SeoState>{t(badge)}</SeoState>
                        </div>
                      ) : null}
                      {row.exclusionReason ? (
                        <p className="text-muted-foreground mt-2 text-sm">
                          {row.exclusionReason}
                        </p>
                      ) : null}
                    </TableCell>
                    {shown.rank ? (
                      <TableCell
                        className="text-right tabular-nums"
                        data-label={t("competitors.rank")}
                      >
                        {number(row.rank)}
                      </TableCell>
                    ) : null}
                    {shown.backlinks ? (
                      <TableCell
                        className="text-right tabular-nums"
                        data-label={t("competitors.backlinks")}
                      >
                        {number(row.backlinks)}
                      </TableCell>
                    ) : null}
                    {shown.domains ? (
                      <TableCell
                        className="text-right tabular-nums"
                        data-label={t("competitors.domains")}
                      >
                        {number(row.referringDomains)}
                      </TableCell>
                    ) : null}
                    {shown.observed ? (
                      <TableCell data-label={t("observed")}>
                        <SeoDate value={row.observedAt} />
                      </TableCell>
                    ) : null}
                    {shown.source ? (
                      <TableCell data-label={t("source")}>
                        <span className="text-muted-foreground text-sm">
                          {row.source}
                        </span>
                        {row.observationId ? (
                          <div>
                            <SeoSource
                              workspace={model.data}
                              observationId={row.observationId}
                            />
                          </div>
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right">
                      {/* No buttons, no wrapper: an empty cell takes no row on a phone. */}
                      {compare || toggle ? (
                        <div className="flex flex-wrap justify-end gap-2 max-sm:justify-start">
                          {compare ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                model.openChat(
                                  t("competitors.compareDraft", {
                                    url: row.url,
                                  }),
                                )
                              }
                            >
                              {t("competitors.compare")}
                            </Button>
                          ) : null}
                          {toggle ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={model.pending}
                              onClick={() => {
                                void model.toggleCompetitor(row);
                              }}
                            >
                              {t(
                                row.confirmed
                                  ? "competitors.unconfirm"
                                  : "competitors.confirm",
                              )}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {hidden.length ? (
            // Missing numbers always say why: paid data off, or not measured yet.
            <p className="text-muted-foreground border-t px-4 py-2 text-xs">
              {paidOff && (!shown.rank || !shown.backlinks)
                ? t("competitors.paidOff")
                : t("unmeasuredColumns", { columns: format.list(hidden) })}
            </p>
          ) : null}
        </div>
      ) : (
        <SeoEmpty
          title={t("competitors.empty")}
          description={t(
            model.data.availableActions.canRequestAnalysis
              ? "competitors.emptyBody"
              : "competitors.emptyBodyOff",
          )}
        />
      )}
      {all.length > SEO_LIST_PAGE_SIZE && !model.competitorSearch ? (
        <SeoShowMore
          more={t("competitors.more", {
            count: all.length - SEO_LIST_PAGE_SIZE,
          })}
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
        />
      ) : null}
    </SeoSection>
  );
}
