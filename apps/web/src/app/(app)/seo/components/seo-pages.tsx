"use client";

import { Check, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { seoPageSummaries } from "./seo-overview-model";
import {
  SeoAddButton,
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import {
  latestSeoMeasurements,
  seoReportedPeriod,
} from "./seo-statistics-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Saved selections and page rankings only help when there are pages to compare. */
export const MIN_PAGES_FOR_SELECTIONS = 2;
/** With two pages a selection is one page or both, and the page picker offers each. */
const MIN_PAGES_TO_OFFER_SELECTION = 3;

/** Search totals that belong to one page: only when the saved statistics cover that page alone. */
// The same order as the Performance tiles.
const PAGE_TOTALS = ["clicks", "impressions", "ctr", "position"] as const;

export function SeoPages({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const summaries = seoPageSummaries(model.data);
  const scopePages = model.data.scope.pageIds;
  const search = latestSeoMeasurements(model.data.metrics).filter(
    (metric) => metric.source === "search_console",
  );
  const choosable = model.data.pages.length >= MIN_PAGES_FOR_SELECTIONS;
  // An empty card for saved selections only says "none"; the card shows once one exists.
  const selections = choosable && model.data.scopes.length > 0;
  const datesFiltered = Boolean(model.data.scope.from || model.data.scope.to);
  const totalsPeriod = search[0]
    ? // The same rule as the query rows: only the end moves to the last reported day.
      {
        from: search[0].from,
        to: seoReportedPeriod(search)?.to ?? search[0].to,
      }
    : null;
  // A lone primary page is the header's URL; the card would only repeat it.
  // "Add a page" stays in Manage SEO and the Agent's steps.
  const [only] = model.data.pages;
  const primaryPages = model.data.pages.filter(
    (page) => page.relationship === "primary",
  ).length;
  if (
    model.data.pages.length === 1 &&
    // The header names the page only while it is the one in view.
    scopePages[0] === only.id &&
    only.relationship === "primary" &&
    (!only.label || only.label === only.url) &&
    !datesFiltered
  )
    return null;
  return (
    <div className={cn("grid gap-6", selections && "xl:grid-cols-2")}>
      <SeoSection
        title={t("pages.title")}
        actions={
          model.data.availableActions.canEdit ? (
            <div className="flex flex-wrap gap-2">
              {/* Without a saved selection there is no card for it; the button to save the first one sits here. */}
              {model.data.pages.length >= MIN_PAGES_TO_OFFER_SELECTION &&
              !selections ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => model.setDialog("scope")}
                >
                  <Plus />
                  {t("createScope")}
                </Button>
              ) : null}
              <SeoAddButton
                label={t("addPage")}
                onClick={() => model.setDialog("page")}
              />
            </div>
          ) : null
        }
      >
        {model.data.pages.length ? (
          // One list, one row per page, in the look of the issue rows.
          <ul className={cn(HOLDER_ITEM_CLASS, "divide-y")}>
            {model.data.pages.map((page) => {
              const parent = model.data.pages.find(
                (candidate) => candidate.id === page.relatedToPageId,
              );
              // With one page the Timeline lists its checks; a date filter keeps "No check in these dates".
              const summary =
                choosable || datesFiltered ? summaries.get(page.id) : undefined;
              const totals =
                // A 1-page Audit shows these totals on Overview already.
                model.data.pages.length > 1 &&
                scopePages.length === 1 &&
                scopePages[0] === page.id
                  ? PAGE_TOTALS.flatMap((key) => {
                      const metric = search.find((item) => item.key === key);
                      // An unavailable read is not a measurement, as on the Performance card.
                      return metric &&
                        metric.value !== null &&
                        metric.coverage !== "unavailable"
                        ? [{ key, value: metric.value }]
                        : [];
                    })
                  : [];
              return (
                <li key={page.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      {page.label && page.label !== page.url ? (
                        <h3 className="text-sm font-medium break-words">
                          {page.label}
                        </h3>
                      ) : null}
                      <SeoPageLink url={page.url} />
                    </div>
                    {/* The badge marks the page that differs: a page added beside the primary page. */}
                    {page.relationship !== "primary" ? (
                      <SeoState>{t("related")}</SeoState>
                    ) : null}
                  </div>
                  {/* With one primary page the badge says what the page is related to, unless its parent is another page. */}
                  {parent &&
                  (primaryPages > 1 || parent.relationship !== "primary") ? (
                    <p className="text-muted-foreground text-sm">
                      {t("relatedTo")}: {parent.label || parent.url}
                    </p>
                  ) : null}
                  {summary ? (
                    // The result of the page's last check; its date opens the results.
                    <p className="text-muted-foreground text-sm">
                      {summary.checkedAt ? (
                        <>
                          <SeoSource
                            observationId={summary.checkId}
                            workspace={model.data}
                          >
                            {t("pages.lastCheck")}{" "}
                            <SeoDate day value={summary.checkedAt} />
                          </SeoSource>
                          {" · "}
                          {/* Known issues stay visible; an incomplete check adds its note. */}
                          {summary.incomplete && !summary.issues
                            ? t("pages.checkIncomplete")
                            : t("pages.issues", { count: summary.issues })}
                          {summary.incomplete && summary.issues
                            ? ` · ${t("pages.checkIncomplete")}`
                            : null}
                        </>
                      ) : (
                        // Checks outside the date filter are not in view.
                        t(
                          datesFiltered
                            ? "pages.notCheckedInDates"
                            : "pages.notChecked",
                        )
                      )}
                    </p>
                  ) : null}
                  {totals.length ? (
                    // Two columns on a phone, like the query and keyword cards.
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:flex sm:flex-wrap sm:gap-x-5">
                      {totals.map(({ key, value }) => (
                        <div key={key}>
                          <dt className="text-muted-foreground text-xs">
                            {t(`metrics.${key}`)}
                          </dt>
                          <dd className="font-medium tabular-nums">
                            {key === "ctr"
                              ? format.number(value, {
                                  style: "percent",
                                  maximumFractionDigits: 1,
                                })
                              : format.number(value, {
                                  minimumFractionDigits:
                                    key === "position" ? 1 : 0,
                                  maximumFractionDigits:
                                    key === "position" ? 1 : 0,
                                })}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {totals.length && totalsPeriod ? (
                    <p className="text-muted-foreground text-xs">
                      {t("statistics.search_console")} ·{" "}
                      <SeoPeriod {...totalsPeriod} />
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <SeoEmpty title={t("noPages")} description={t("noPagesBody")} />
        )}
      </SeoSection>
      {selections ? (
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
        </SeoSection>
      ) : null}
    </div>
  );
}
