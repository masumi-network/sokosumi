"use client";

import { useFormatter, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
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
import useIsClient from "@/hooks/use-is-client";
import { SeoAiAssistants } from "./seo-ai-assistants";
import { SeoBreakdown } from "./seo-breakdown";
import { SeoExportMenu } from "./seo-export-menu";
import { seoTopPagesExport } from "./seo-export-model";
import { SEO_MAX_PAGES } from "./seo-form-model";
import { SeoLandingEngagement } from "./seo-landing-engagement";
import { SeoMeasurements } from "./seo-measurements";
import { MIN_PAGES_FOR_SELECTIONS } from "./seo-pages";
import { SeoQueryFilter } from "./seo-query-filter";
import { topPages } from "./seo-search-model";
import { SeoSearchQueries } from "./seo-search-queries";
import { SeoSearchTypeFilter } from "./seo-search-type-filter";
import {
  SEO_STACKED_TABLE_CLASS,
  SeoFoldSummary,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
  seoSiteUrl,
} from "./seo-shared";
import { SeoSiteTrafficReportView } from "./seo-site-traffic";
import { seoQueryPeriod } from "./seo-statistics-model";
import {
  readTrafficPages,
  saveTrafficPages,
  seoKeyEvents,
  seoTrafficPageOptions,
} from "./seo-traffic-model";
import { SeoTrafficPageFilter } from "./seo-traffic-page-filter";
import { useSeoSiteTraffic } from "./use-seo-site-traffic";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const trafficScopes = ["site", "selected"] as const;

export function SeoTraffic({ model }: { model: SeoWorkspaceModel }) {
  const storageKey = JSON.stringify([
    "seo-traffic-pages",
    model.setupScopeKey,
    model.data.projectId,
    model.data.websiteUrl,
    model.filters.pageId,
    model.filters.scopeId,
  ]);
  return (
    <SeoTrafficContent key={storageKey} storageKey={storageKey} model={model} />
  );
}
function SeoTrafficContent({
  model,
  storageKey,
}: {
  model: SeoWorkspaceModel;
  storageKey: string;
}) {
  const t = useTranslations("App.Seo");
  const [choice, setChoice] = useQueryState(
    "trafficScope",
    parseAsStringLiteral(trafficScopes),
  );
  const scope =
    choice ??
    (model.filters.pageId || model.filters.scopeId || model.filters.channel
      ? "selected"
      : "site");
  const [urls, setUrls] = useState<string[]>();
  const client = useIsClient();
  const previous = useMemo(
    () => (client ? readTrafficPages(storageKey) : undefined),
    [client, storageKey],
  );
  function applyPages(pages: string[]) {
    setUrls(pages);
    saveTrafficPages(storageKey, pages);
  }
  const whole = useSeoSiteTraffic(model, "site");
  const { selected, options, selectedIds } = seoTrafficPageOptions(
    model.data,
    seoSiteUrl(model.data),
    whole.query.data?.pages ?? [],
    urls ?? previous,
  );
  const selection = useSeoSiteTraffic(
    model,
    "selected",
    selected,
    scope === "selected" && client,
    selectedIds,
  );
  const { query, available, pending, tooMany, canChooseScope, retry } =
    scope === "site" ? whole : selection;
  const live = available && !query.isError ? query.data : undefined;
  const hasReport =
    live &&
    (live.totals !== null ||
      live.pages.length > 0 ||
      Boolean(live.daily?.length));
  // Nothing measured yet: one card says what to connect. A second empty card would ask for the same account.
  const hasSaved = Boolean(
    model.data.metrics.length ||
      model.data.searchQueries ||
      model.data.landingEngagementChange ||
      model.data.searchBreakdown ||
      model.data.landingPages,
  );
  const saved = (
    <>
      <SeoMeasurements model={model} />
      {hasSaved && <SeoSelectedTraffic model={model} />}
    </>
  );
  return (
    <div className="space-y-6">
      <SeoSearchTypeFilter model={model} />
      {canChooseScope && (
        <>
          <SeoTrafficPageFilter
            scope={scope}
            onScope={(v) => void setChoice(v)}
            options={options}
            selected={selected}
            propertyId={whole.propertyId}
            onApply={applyPages}
          />
          {hasReport ? (
            <SeoSiteTrafficReportView key={scope + live.site} report={live} />
          ) : live ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("siteTraffic.noRows")}
            </p>
          ) : retry ? (
            <div role="status">
              {t("siteTraffic.failed")}{" "}
              <Button variant="outline" onClick={() => void retry()}>
                {t("retry")}
              </Button>
            </div>
          ) : (
            <p role="status">
              {tooMany
                ? t("selectPagesLimit", { count: SEO_MAX_PAGES })
                : t(
                    pending || available
                      ? "siteTraffic.loading"
                      : "siteTraffic.unavailable",
                  )}
            </p>
          )}
        </>
      )}
      {hasSaved ? (
        <details className="space-y-3" open={canChooseScope ? undefined : true}>
          <SeoFoldSummary
            className={canChooseScope ? "py-3 text-sm font-medium" : "hidden"}
          >
            {t("siteTraffic.savedReports")}
          </SeoFoldSummary>
          {saved}
        </details>
      ) : hasReport ? null : (
        saved
      )}
    </div>
  );
}

function SeoSelectedTraffic({ model }: { model: SeoWorkspaceModel }) {
  return (
    <div className="stagger space-y-6">
      {model.data.landingEngagementChange && (
        <SeoLandingEngagement change={model.data.landingEngagementChange} />
      )}
      <SeoQueryFilter
        model={model}
        rows={model.data.searchQueries?.rows.length ?? 0}
      />
      <SeoSearchQueries model={model} />
      <SeoTopPages model={model} />
      <SeoAiAssistants model={model} />
      <SeoBreakdown model={model} />
    </div>
  );
}

export function SeoTopPages({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const source = model.data.searchQueries;
  const rows = source ? topPages(source.rows) : [];
  const keyEvents = seoKeyEvents(model.data.landingPages);
  const keyEventsLabel = keyEvents?.label ?? "traffic.keyEvents";
  // One page's totals are on the Performance card; its listed-query sums would only disagree with them.
  if (!source || rows.length < MIN_PAGES_FOR_SELECTIONS) return null;
  const rate = (value: number | null, percent = false) =>
    value === null
      ? t("none")
      : format.number(value, {
          maximumFractionDigits: 1,
          ...(percent ? { style: "percent" } : {}),
        });
  return (
    <SeoSection
      title={t("pages.topPages")}
      actions={
        <SeoExportMenu
          name="top-pages"
          titleKey="pages.topPages"
          workspace={model.data}
          table={(report) => seoTopPagesExport(rows, report, keyEvents)}
        />
      }
      description={
        <>
          {t("pages.topPagesHelp")} ·{" "}
          <SeoPeriod {...seoQueryPeriod(source, model.data.metrics)} />
          {source.truncated
            ? ` · ${t("queries.truncated", { count: source.rowLimit })}`
            : null}
          {keyEvents ? (
            <>
              {" · "}
              {t(keyEventsLabel)} <SeoPeriod {...keyEvents.period} />
            </>
          ) : null}
          {keyEvents?.none ? ` · ${t("traffic.noKeyEvents")}` : null}
        </>
      }
    >
      <div className={HOLDER_ITEM_CLASS}>
        <Table className={SEO_STACKED_TABLE_CLASS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("page")}</TableHead>
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
              <TableHead className="text-right">
                {t("pages.queryCount")}
              </TableHead>
              {keyEvents ? (
                <TableHead className="text-right">
                  {t(keyEventsLabel)}
                </TableHead>
              ) : null}
              <TableHead>{t("pages.topQuery")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.pageUrl}>
                <TableCell className="min-w-48 whitespace-normal">
                  <SeoPageLink url={row.pageUrl} />
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-label={t("queries.clicks")}
                >
                  {format.number(row.clicks)}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-label={t("queries.impressions")}
                >
                  {format.number(row.impressions)}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-label={t("queries.ctr")}
                >
                  {rate(row.ctr, true)}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-label={t("queries.position")}
                >
                  {rate(row.averagePosition)}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-label={t("pages.queryCount")}
                >
                  {format.number(row.queries)}
                </TableCell>
                {keyEvents ? (
                  <TableCell
                    className="text-right tabular-nums"
                    data-label={t(keyEventsLabel)}
                  >
                    {keyEvents.skipped.has(row.pageUrl)
                      ? t("traffic.keyEventsNotRead")
                      : rate(keyEvents.byPage.get(row.pageUrl) ?? null)}
                  </TableCell>
                ) : null}
                <TableCell
                  className="min-w-40 whitespace-normal break-words"
                  data-label={t("pages.topQuery")}
                >
                  <bdi>{row.topQuery}</bdi>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SeoSection>
  );
}
