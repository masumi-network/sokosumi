"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
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
  hiddenImpressions,
  nextQuerySort,
  normalizeQuery,
  positionBuckets,
  SEO_DEFAULT_QUERY_SORT,
  SEO_POSITION_BUCKETS,
  type SeoQuerySort,
  type SeoQuerySortKey,
  sortQueryRows,
} from "./seo-search-model";
import {
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
} from "./seo-shared";
import { savedSeoStatistics } from "./seo-statistics-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SORT_COLUMNS: { key: SeoQuerySortKey; label: string }[] = [
  { key: "clicks", label: "queries.clicks" },
  { key: "impressions", label: "queries.impressions" },
  { key: "ctr", label: "queries.ctr" },
  { key: "averagePosition", label: "queries.position" },
];

function SortHead({
  column,
  sort,
  onSort,
}: {
  column: (typeof SORT_COLUMNS)[number];
  sort: SeoQuerySort;
  onSort: (key: SeoQuerySortKey) => void;
}) {
  const t = useTranslations("App.Seo");
  const active = sort.key === column.key;
  const Arrow = sort.ascending ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className="text-right"
      aria-sort={
        active ? (sort.ascending ? "ascending" : "descending") : undefined
      }
    >
      <button
        type="button"
        className="hover:text-foreground inline-flex items-center gap-1 font-medium"
        onClick={() => onSort(column.key)}
      >
        {t(column.label)}
        {active ? <Arrow className="size-3" aria-hidden /> : null}
      </button>
    </TableHead>
  );
}

/** Measured Search Console rows. Not search volume and not a live rank. */
export function SeoSearchQueries({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const [sort, setSort] = useState(SEO_DEFAULT_QUERY_SORT);
  const source = model.data.searchQueries;
  const saved = savedSeoStatistics(model.data.metrics, "search_console");
  const canSync = model.data.availableActions.canSyncMetrics;
  const rows = sortQueryRows(model.filteredQueries, sort);
  const buckets = positionBuckets(rows);
  const hidden = hiddenImpressions(model.data);
  const tracked = new Set(
    model.data.keywords
      .filter((keyword) => keyword.saved)
      .map((keyword) => normalizeQuery(keyword.keyword)),
  );
  return (
    <SeoSection
      title={t("queries.title")}
      actions={
        canSync && saved ? (
          <Button
            size="sm"
            variant="outline"
            loading={model.pending}
            onClick={() => {
              void model.refreshSearchStatistics(saved);
            }}
          >
            {t("queries.refresh")}
          </Button>
        ) : null
      }
    >
      <p className="text-muted-foreground px-2 pb-1 text-sm">
        {t("queries.help")}
      </p>
      {source ? (
        <p className="text-muted-foreground px-2 pb-3 text-xs">
          <SeoPeriod from={source.from} to={source.to} /> ·{" "}
          {t("queries.lastSynced")}: <SeoDate value={source.observedAt} />
          {source.truncated
            ? ` · ${t("queries.truncated", { count: source.rowLimit })}`
            : ""}
        </p>
      ) : null}
      {!source ? (
        <SeoEmpty
          title={t(saved ? "queries.notLoaded" : "queries.notConnected")}
          body={t(saved ? "queries.notLoadedBody" : "queries.notConnectedBody")}
        >
          {canSync && saved ? (
            <Button
              variant="outline"
              loading={model.pending}
              onClick={() => {
                void model.refreshSearchStatistics(saved);
              }}
            >
              {t("queries.refresh")}
            </Button>
          ) : canSync ? (
            <Button
              variant="outline"
              onClick={() => model.openStatistics("search_console")}
            >
              {t("queries.connect")}
            </Button>
          ) : null}
        </SeoEmpty>
      ) : rows.length ? (
        <>
          <dl
            aria-label={t("queries.buckets.label")}
            className="flex flex-wrap gap-x-4 gap-y-1 px-2 pb-3 text-xs"
          >
            {SEO_POSITION_BUCKETS.map((bucket) => (
              <div key={bucket} className="flex items-baseline gap-1">
                <dt className="text-muted-foreground">
                  {t(`queries.buckets.${bucket}`)}
                </dt>
                <dd className="font-medium tabular-nums">
                  {format.number(buckets[bucket])}
                </dd>
              </div>
            ))}
          </dl>
          <div className={HOLDER_ITEM_CLASS}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("queries.query")}</TableHead>
                  {SORT_COLUMNS.map((column) => (
                    <SortHead
                      key={column.key}
                      column={column}
                      sort={sort}
                      onSort={(key) => setSort(nextQuerySort(sort, key))}
                    />
                  ))}
                  <TableHead>
                    <span className="sr-only">{t("queries.rowActions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-48 whitespace-normal">
                      <p className="font-medium break-words">
                        <bdi>{row.query}</bdi>
                      </p>
                      <SeoPageLink url={row.pageUrl} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.number(row.clicks)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.number(row.impressions)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.number(row.ctr, {
                        style: "percent",
                        maximumFractionDigits: 1,
                      })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.number(row.averagePosition, {
                        maximumFractionDigits: 1,
                      })}
                    </TableCell>
                    <TableCell>
                      {tracked.has(normalizeQuery(row.query)) ? (
                        <span className="text-muted-foreground text-sm">
                          {t("queries.tracked")}
                        </span>
                      ) : model.data.availableActions.canEdit ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={model.pending}
                          aria-label={t("queries.trackLabel", {
                            query: row.query,
                          })}
                          onClick={() => model.trackQuery(row)}
                        >
                          {t("queries.track")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {hidden && hidden.hidden > 0 ? (
              <p className="text-muted-foreground border-t px-4 py-2 text-xs">
                {t("queries.hiddenImpressions", {
                  listed: hidden.listed,
                  total: hidden.total,
                })}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <SeoEmpty
          title={t(model.keywordSearch ? "queries.noMatch" : "queries.empty")}
          body={t(
            model.keywordSearch ? "queries.noMatchBody" : "queries.emptyBody",
          )}
        />
      )}
    </SeoSection>
  );
}
