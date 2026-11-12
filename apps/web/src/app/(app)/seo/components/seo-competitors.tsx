"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
import { SeoRowMenu } from "./seo-row-menu";
import {
  SEO_COMPACT_ROWS_CLASS,
  SeoAddButton,
  SeoDate,
  SeoEmpty,
  SeoFoldSummary,
  SeoPageLink,
  SeoSection,
  SeoShowMore,
  SeoSource,
  SeoState,
  seoFoldCount,
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
  const visible = seoFoldCount(sites.length);
  const rows =
    expanded || model.competitorSearch ? sites : sites.slice(0, visible);
  const number = (value: number | null) =>
    value === null ? t("none") : format.number(value);
  // The checks are dated once above the table, not on every row. A date on each row stood on 10 of 11 rows when
  // one check found one new site. The rows can come from several checks, so the line names the day of the
  // oldest and of the newest: one date alone would give an older row the newer date.
  // A competitor the reader added comes from no check, and a row without a date cannot date the line.
  // The whole list counts, not the rows of a search: the line stands over the search field, and a line that
  // comes and goes while the reader types moves the field.
  const time = (value: string | Date | null) =>
    value ? new Date(value).getTime() : 0;
  // No row carries a date, so every row counts: the further pages of a site and the other sites in the
  // results show positions too.
  const dated = model.data.competitors
    .filter((row) => row.role !== "page" && row.observationId && row.observedAt)
    .sort((a, b) => time(b.observedAt) - time(a.observedAt));
  const newest = dated.at(0);
  const day = (value: string | Date | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium" }) : "";
  const firstDay = day(dated.at(-1)?.observedAt ?? null);
  // A column no row has measured only repeats "Not available"; name it once instead.
  const shown = {
    rank: all.some((row) => row.rank !== null),
    backlinks: all.some((row) => row.backlinks !== null),
    domains: all.some((row) => row.referringDomains !== null),
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
      {newest ? (
        // The date opens the results of the newest check. It stands under the title, at the place and in the
        // size of the meta line on Keywords, so the line holds its place when the switch changes the list.
        <p className="text-muted-foreground px-2 pb-1 text-sm">
          <SeoSource
            workspace={model.data}
            observationId={newest.observationId}
          >
            {firstDay === day(newest.observedAt) ? (
              <>
                {t("keywords.readOn")} <SeoDate day value={newest.observedAt} />
              </>
            ) : (
              t("competitors.checkedBetween", {
                from: firstDay,
                to: day(newest.observedAt),
              })
            )}
          </SeoSource>
        </p>
      ) : null}
      {/* A list that shows every site needs no filter. */}
      {sites.length > visible || model.competitorSearch ? (
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
              row.observationId !== newest?.observationId ? (
                <SeoSource
                  workspace={model.data}
                  observationId={row.observationId}
                />
              ) : null}
            </dd>
          ))}
        </dl>
      ) : null}
      {rows.length ? (
        <div className={HOLDER_ITEM_CLASS}>
          <Table className={SEO_COMPACT_ROWS_CLASS}>
            {/* A lone "Site" header names what every row already shows. */}
            <TableHeader
              className={cn(
                !(shown.rank || shown.backlinks || shown.domains) && "sr-only",
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
                      <SeoPageLink url={row.url} site={row.url} clamp quiet />
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
                        <details className="text-muted-foreground text-xs">
                          <SeoFoldSummary className="py-2">
                            {t("competitors.morePages", {
                              count: pages.length - 1,
                            })}
                          </SeoFoldSummary>
                          <ul className="space-y-1 pb-1">
                            {pages.slice(1).map((page) => (
                              <li key={page.id}>
                                <SeoPageLink
                                  url={page.url}
                                  site={page.url}
                                  quiet
                                />
                                {facts(page) ? (
                                  <p className="tabular-nums">{facts(page)}</p>
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
                        className={cn(
                          "text-right tabular-nums",
                          row.backlinks === 0 && "text-muted-foreground",
                        )}
                        data-label={t("competitors.backlinks")}
                      >
                        {number(row.backlinks)}
                      </TableCell>
                    ) : null}
                    {shown.domains ? (
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          // A measured 0 stays, in the quiet colour: the sites with links stand out of the column.
                          row.referringDomains === 0 && "text-muted-foreground",
                        )}
                        // A phone row has no column head: the short name keeps both values on one line.
                        data-label={t("competitors.domainsShort")}
                      >
                        {/* A plain number: one site with many links made every other bar empty. */}
                        {number(row.referringDomains)}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right">
                      {/* One menu per row: two buttons made the table wider than its card. No action, no trigger. */}
                      {compare || toggle ? (
                        <SeoRowMenu
                          label={t("competitors.rowActions", { url: row.url })}
                        >
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
                        </SeoRowMenu>
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
      {sites.length > visible && !model.competitorSearch ? (
        <SeoShowMore
          more={t("competitors.more", {
            count: sites.length - visible,
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
