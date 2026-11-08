"use client";

import { Check, Plus } from "lucide-react";
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
import { topPages } from "./seo-search-model";
import {
  SeoEmpty,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
  SeoState,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Saved selections only help when there are pages to choose between. */
const MIN_PAGES_FOR_SELECTIONS = 2;

function SeoTopPages({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const source = model.data.searchQueries;
  if (!source?.rows.length) return null;
  const rows = topPages(source.rows);
  const rate = (value: number | null, percent = false) =>
    value === null
      ? t("none")
      : format.number(value, {
          maximumFractionDigits: 1,
          ...(percent ? { style: "percent" } : {}),
        });
  return (
    <div className="xl:col-span-2">
      <SeoSection
        title={t("pages.topPages")}
        description={
          <>
            {t("pages.topPagesHelp")} ·{" "}
            <SeoPeriod from={source.from} to={source.to} />
            {source.truncated
              ? ` · ${t("queries.truncated", { count: source.rowLimit })}`
              : null}
          </>
        }
      >
        <div className={HOLDER_ITEM_CLASS}>
          <Table>
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
                <TableHead>{t("pages.topQuery")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.pageUrl}>
                  <TableCell className="min-w-48 whitespace-normal">
                    <SeoPageLink url={row.pageUrl} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format.number(row.clicks)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format.number(row.impressions)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(row.ctr, true)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(row.averagePosition)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format.number(row.queries)}
                  </TableCell>
                  <TableCell className="min-w-40 whitespace-normal break-words">
                    <bdi>{row.topQuery}</bdi>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SeoSection>
    </div>
  );
}

export function SeoPages({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SeoTopPages model={model} />
      <SeoSection
        title={t("pages.title")}
        actions={
          model.data.availableActions.canEdit ? (
            <Button size="sm" onClick={() => model.setDialog("page")}>
              <Plus className="size-4" />
              {t("addPage")}
            </Button>
          ) : null
        }
      >
        {model.data.pages.length ? (
          <ul className="space-y-2">
            {model.data.pages.map((page) => {
              const parent = model.data.pages.find(
                (candidate) => candidate.id === page.relatedToPageId,
              );
              return (
                <li
                  key={page.id}
                  className={`${HOLDER_ITEM_CLASS} space-y-3 p-4`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      {page.label && page.label !== page.url ? (
                        <h3 className="text-sm font-medium break-words">
                          {page.label}
                        </h3>
                      ) : null}
                      <SeoPageLink url={page.url} />
                    </div>
                    <SeoState>{t(page.relationship)}</SeoState>
                  </div>
                  {page.relatedToPageId ? (
                    <p className="text-muted-foreground text-sm">
                      {t("relatedTo")}:{" "}
                      {parent?.label || parent?.url || t("page")}
                    </p>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void model.setFilters({ pageId: page.id, scopeId: null });
                    }}
                  >
                    {model.filters.pageId === page.id ? (
                      <Check className="size-4" />
                    ) : null}
                    {t("pages.choose")}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <SeoEmpty title={t("noPages")} description={t("noPagesBody")} />
        )}
      </SeoSection>
      {model.data.pages.length < MIN_PAGES_FOR_SELECTIONS ? null : (
        <SeoSection
          title={t("pages.groups")}
          actions={
            model.data.availableActions.canEdit && model.data.pages.length ? (
              <Button size="sm" onClick={() => model.setDialog("scope")}>
                <Plus className="size-4" />
                {t("createScope")}
              </Button>
            ) : null
          }
        >
          {model.data.scopes.length ? (
            <ul className="space-y-2">
              {model.data.scopes.map((scope) => (
                <li
                  className={`${HOLDER_ITEM_CLASS} space-y-3 p-4`}
                  key={scope.id}
                >
                  <div>
                    <h3 className="text-sm font-medium">{scope.name}</h3>
                    <p className="text-muted-foreground text-sm">
                      {t("pages.count", { count: scope.pageIds.length })} ·{" "}
                      {t("pages.version", { version: scope.version })}
                    </p>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {scope.pageIds.map((id) => {
                      const page = model.data.pages.find(
                        (candidate) => candidate.id === id,
                      );
                      return page ? (
                        <li key={id}>
                          <SeoPageLink url={page.url} label={page.label} />
                        </li>
                      ) : null;
                    })}
                  </ul>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void model.setFilters({
                        scopeId: scope.id,
                        pageId: null,
                      });
                    }}
                  >
                    {model.filters.scopeId === scope.id ? (
                      <Check className="size-4" />
                    ) : null}
                    {t("pages.chooseSelection")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <SeoEmpty description={t("pages.emptyGroups")} />
          )}
        </SeoSection>
      )}
    </div>
  );
}
