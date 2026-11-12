"use client";

import { MoreHorizontal } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  competitorSites,
  type SeoCompetitorSite,
} from "./seo-competitors-model";
import {
  SEO_COMPACT_ROWS_CLASS,
  SEO_LIST_PAGE_SIZE,
  SeoAddButton,
  SeoDate,
  SeoEmpty,
  SeoFoldSummary,
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
  // The reader's own pages are not competitors: they sit above the table.
  const own = model.filteredCompetitors.filter((row) => row.role === "page");
  const all = model.filteredCompetitors.filter((row) => row.role !== "page");
  // One row per site, the sites the reader chose first; video sites, forums and help pages are apart.
  const { sites, platforms } = competitorSites(all);
  const [expanded, setExpanded] = useState(false);
  // A search already narrows the list; it shows every match.
  const rows =
    expanded || model.competitorSearch
      ? sites
      : sites.slice(0, SEO_LIST_PAGE_SIZE);
  const number = (value: number | null) =>
    value === null ? t("none") : format.number(value);
  // One check for every row is said once above the table, not in two columns of every row.
  // A competitor the reader added comes from no check.
  const checks = new Set(
    all.flatMap((row) => (row.observationId ? [row.observationId] : [])),
  );
  // A row without a date cannot date the line.
  const oneCheck =
    checks.size === 1
      ? all.find((row) => row.observationId && row.observedAt)
      : undefined;
  // A column no row has measured only repeats "Not available"; name it once instead.
  const shown = {
    rank: all.some((row) => row.rank !== null),
    backlinks: all.some((row) => row.backlinks !== null),
    domains: all.some((row) => row.referringDomains !== null),
    observed: !oneCheck && all.some((row) => row.observedAt !== null),
  };
  // The check reads no backlink count for a competitor, so the line under the table does not name that column.
  const hidden = [
    shown.rank ? null : t("competitors.rank"),
    shown.domains ? null : t("competitors.domainsShort"),
  ].filter((label): label is string => label !== null);
  const paidOff = model.data.availableActions.canUsePaidSearchData !== true;
  // A page the reader added and then stopped tracking came from no check.
  const chosen = (row: SeoCompetitorSite["lead"]) =>
    row.confirmed || row.source === "saved";
  // The badge tells a found page from a chosen one; in a list of found pages only, the line above says it once.
  const mixed = all.some(chosen) && !all.every(chosen);
  // The numbers of one page, for the lines under a site and in the platform list.
  const facts = (row: SeoCompetitorSite["lead"]) =>
    [
      row.rank === null
        ? null
        : t("competitors.positionOf", { rank: row.rank }),
      row.referringDomains === null
        ? null
        : t("competitors.domainsOf", { count: row.referringDomains }),
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <SeoSection
      // The switch above names the list, so the title says what the list holds.
      title={t("competitors.help")}
      // The three lists of the switch start with a title of one size.
      strong
      actions={
        model.data.availableActions.canEdit ? (
          <SeoAddButton
            label={t("competitors.add")}
            onClick={() => model.setDialog("competitor")}
          />
        ) : null
      }
    >
      {/* A list that shows every site needs no filter. */}
      {sites.length > SEO_LIST_PAGE_SIZE || model.competitorSearch ? (
        <div className="px-2 pb-3">
          <Label htmlFor="seo-competitor-search" className="sr-only">
            {t("search")}
          </Label>
          <Input
            id="seo-competitor-search"
            type="search"
            value={model.competitorSearch}
            onChange={(event) => model.setCompetitorSearch(event.target.value)}
            placeholder={t("competitors.searchPlaceholder")}
          />
        </div>
      ) : null}
      {own.length ? (
        <dl className="space-y-1 px-2 pb-3 text-sm">
          <dt className="font-medium">
            {t("competitors.yourPages", { count: own.length })}
          </dt>
          {own.map((row) => (
            <dd
              key={row.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
            >
              <SeoPageLink url={row.url} />
              {row.backlinks !== null || row.referringDomains !== null ? (
                <span className="text-muted-foreground tabular-nums">
                  {/* One link number, in the words of the competitor rows: the sites that link. The link count shows only without it. */}
                  {row.referringDomains === null
                    ? `${t("competitors.backlinks")}: ${number(row.backlinks)}`
                    : t("competitors.domainsOf", {
                        count: row.referringDomains,
                      })}
                </span>
              ) : null}
              {row.observationId &&
              row.observationId !== oneCheck?.observationId ? (
                <SeoSource
                  workspace={model.data}
                  observationId={row.observationId}
                />
              ) : null}
            </dd>
          ))}
        </dl>
      ) : null}
      {oneCheck ? (
        // The date opens the results of the check.
        <p className="text-muted-foreground px-2 pb-2 text-xs">
          <SeoSource
            workspace={model.data}
            observationId={oneCheck.observationId}
          >
            {t("keywords.readOn")} <SeoDate day value={oneCheck.observedAt} />
          </SeoSource>
        </p>
      ) : null}
      {rows.length ? (
        <div className={HOLDER_ITEM_CLASS}>
          <Table className={SEO_COMPACT_ROWS_CLASS}>
            {/* A lone "Site" header names what every row already shows. */}
            <TableHeader
              className={cn(
                !(
                  shown.rank ||
                  shown.backlinks ||
                  shown.domains ||
                  shown.observed
                ) && "sr-only",
              )}
            >
              <TableRow>
                <TableHead>{t("competitors.site")}</TableHead>
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
                    {t("competitors.domainsShort")}
                  </TableHead>
                ) : null}
                {shown.observed ? <TableHead>{t("observed")}</TableHead> : null}
                <TableHead>
                  <span className="sr-only">{t("manage")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ host, lead: row, pages, best }) => {
                const compare =
                  row.role === "competitor" && Boolean(model.data.auditId);
                const toggle =
                  model.data.availableActions.canEdit &&
                  row.role === "competitor" &&
                  (row.canConfirm || row.confirmed);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-56 whitespace-normal">
                      <p className="font-medium [overflow-wrap:anywhere]">
                        {host}
                      </p>
                      {/* The site is the line above: the page shows as its path. */}
                      <SeoPageLink url={row.url} site={row.url} clamp />
                      {mixed && !chosen(row) ? (
                        <div className="mt-1">
                          <SeoState>{t("competitors.suggested")}</SeoState>
                        </div>
                      ) : null}
                      {row.exclusionReason ? (
                        <p className="text-muted-foreground mt-2 text-sm">
                          {row.exclusionReason}
                        </p>
                      ) : null}
                      {pages.length > 1 ? (
                        <details className="text-muted-foreground text-sm">
                          <SeoFoldSummary className="py-1.5">
                            {t("competitors.morePages", {
                              count: pages.length - 1,
                            })}
                          </SeoFoldSummary>
                          <ul className="space-y-1 pb-1">
                            {pages.slice(1).map((page) => (
                              <li key={page.id}>
                                <SeoPageLink url={page.url} site={page.url} />
                                {facts(page) ? (
                                  <p className="text-xs tabular-nums">
                                    {facts(page)}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </TableCell>
                    {shown.rank ? (
                      <TableCell
                        className="text-right tabular-nums"
                        data-label={t("competitors.rank")}
                      >
                        {number(best)}
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
                        // A phone row has no column head: the short name keeps both values on one line.
                        data-label={t("competitors.domainsShort")}
                      >
                        {/* A plain number: one site with many links made every other bar empty. */}
                        {number(row.referringDomains)}
                      </TableCell>
                    ) : null}
                    {shown.observed ? (
                      <TableCell data-label={t("observed")}>
                        <SeoDate value={row.observedAt} />
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right">
                      {/* One menu per row: two buttons made the table wider than its card. No action, no trigger. */}
                      {compare || toggle ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              // Ten bright marks read as ten equal choices: the mark is quiet until the row is in use.
                              className="text-muted-foreground hover:text-foreground min-w-10"
                              aria-label={t("competitors.rowActions", {
                                url: row.url,
                              })}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {compare ? (
                              <DropdownMenuItem
                                onSelect={() =>
                                  model.openChat(
                                    t("competitors.compareDraft", {
                                      url: row.url,
                                    }),
                                  )
                                }
                              >
                                {t("competitors.compare")}
                              </DropdownMenuItem>
                            ) : null}
                            {toggle ? (
                              <DropdownMenuItem
                                disabled={model.pending}
                                onSelect={() => {
                                  void model.toggleCompetitor(row);
                                }}
                              >
                                {t(
                                  row.confirmed
                                    ? "competitors.unconfirm"
                                    : "competitors.confirm",
                                )}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {shown.rank ? (
            // Under the rows, on every width: a hint on the column head reaches no phone and no keyboard.
            <p className="text-muted-foreground border-t px-4 py-2 text-xs">
              {t("competitors.rankHint")}
            </p>
          ) : null}
          {(paidOff && (!shown.rank || !shown.backlinks)) || hidden.length ? (
            // Missing numbers say why: paid data off, or not measured yet.
            <p className="text-muted-foreground border-t px-4 py-2 text-xs">
              {paidOff && (!shown.rank || !shown.backlinks)
                ? t("competitors.paidOff")
                : t("unmeasuredColumns", { columns: format.list(hidden) })}
            </p>
          ) : null}
        </div>
      ) : platforms.length ? null : (
        <SeoEmpty
          // A search with no match does not mean there are no competitors.
          title={t(
            model.competitorSearch
              ? "competitors.noMatch"
              : "competitors.empty",
          )}
          description={
            model.competitorSearch
              ? undefined
              : t(
                  model.data.availableActions.canRequestAnalysis
                    ? "competitors.emptyBody"
                    : "competitors.emptyBodyOff",
                )
          }
        />
      )}
      {sites.length > SEO_LIST_PAGE_SIZE && !model.competitorSearch ? (
        <SeoShowMore
          more={t("competitors.more", {
            count: sites.length - SEO_LIST_PAGE_SIZE,
          })}
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
        />
      ) : null}
      {platforms.length ? (
        // In the results, but no rival: closed, so the list above stays the list of competitors.
        <details className="px-2 text-sm">
          <SeoFoldSummary className="py-2.5 font-medium">
            {t("competitors.platforms", { count: platforms.length })}
          </SeoFoldSummary>
          <p className="text-muted-foreground pb-2">
            {t("competitors.platformsHelp")}
          </p>
          <ul className="space-y-2 pb-2">
            {platforms.flatMap((site) =>
              site.pages.map((page) => (
                <li key={page.id}>
                  <SeoPageLink url={page.url} />
                  {facts(page) ? (
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {facts(page)}
                    </p>
                  ) : null}
                </li>
              )),
            )}
          </ul>
        </details>
      ) : null}
    </SeoSection>
  );
}
