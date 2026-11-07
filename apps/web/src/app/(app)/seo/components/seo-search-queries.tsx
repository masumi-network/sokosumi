"use client";

import { useFormatter, useTranslations } from "next-intl";
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
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
} from "./seo-shared";
import { savedSeoStatistics } from "./seo-statistics-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Measured Search Console rows. Not search volume and not a live rank. */
export function SeoSearchQueries({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const source = model.data.searchQueries;
  const saved = savedSeoStatistics(model.data.metrics, "search_console");
  const canSync = model.data.availableActions.canSyncMetrics;
  const rows = model.filteredQueries.toSorted(
    (a, b) => b.clicks - a.clicks || b.impressions - a.impressions,
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
              void model.refreshSearchStatistics(saved.propertyId);
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
                void model.refreshSearchStatistics(saved.propertyId);
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
        <div className={HOLDER_ITEM_CLASS}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("queries.query")}</TableHead>
                <TableHead className="text-right">
                  {t("queries.clicks")}
                </TableHead>
                <TableHead className="text-right">
                  {t("queries.impressions")}
                </TableHead>
                <TableHead className="text-right">{t("queries.ctr")}</TableHead>
                <TableHead className="text-right">
                  {t("queries.position")}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t("queries.rowActions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const tracked = model.data.keywords.some(
                  (keyword) =>
                    keyword.saved &&
                    keyword.keyword.normalize("NFKC").toLowerCase() ===
                      row.query.normalize("NFKC").toLowerCase(),
                );
                return (
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
                      {tracked ? (
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
                );
              })}
            </TableBody>
          </Table>
        </div>
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
