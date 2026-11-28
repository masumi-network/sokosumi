import type { AdminSeoImpactVerdicts } from "@sokosumi/core-client";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AdminSeoImpactFilters,
  AdminSeoImpactPeriod,
  AdminSeoImpactSource,
} from "@/lib/services/admin-seo-impact.service";
import { cn } from "@/lib/utils";

/** The page with `change` applied to the current filters. */
function filterHref(
  filters: AdminSeoImpactFilters,
  change: Partial<AdminSeoImpactFilters>,
) {
  const next = { ...filters, ...change };
  const params = new URLSearchParams({ period: next.period });
  if (next.source) params.set("source", next.source);
  if (next.state) params.set("state", next.state);
  return `/admin/seo-impact?${params}`;
}

/** One row of filter links; the picked one is the current page. */
function FilterLinks({
  label,
  options,
}: {
  label: string;
  options: { key: string; href: string; current: boolean; text: ReactNode }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-muted-foreground w-14 text-xs">{label}</span>
      <nav className="flex flex-wrap gap-1" aria-label={label}>
        {options.map((option) => (
          <Link
            key={option.key}
            href={option.href}
            aria-current={option.current ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm",
              option.current
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.text}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/**
 * Every tracked page change across customers: when it went live, when Google
 * first crawled it after that, the weeks a verdict compares, and why a row
 * still waits or cannot be measured.
 */
export async function SeoImpactTable({
  verdicts,
  filters,
  periods,
  sources,
}: {
  verdicts: AdminSeoImpactVerdicts;
  filters: AdminSeoImpactFilters;
  periods: AdminSeoImpactPeriod[];
  sources: AdminSeoImpactSource[];
}) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SeoImpact"),
    getFormatter(),
  ]);
  const when = (at: Date) => format.dateTime(at, "dateTimeMedium");
  // Search Console dates are Pacific calendar days: UTC keeps the day as written.
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });

  const count = (value: number) => (
    <span className="ml-1.5 tabular-nums">{value}</span>
  );
  // A Core deploy that lags Web sends no counts yet.
  const counts = verdicts.counts ?? [];
  const allStates = counts.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <FilterLinks
          label={t("period")}
          options={periods.map((option) => ({
            key: option,
            href: filterHref(filters, { period: option }),
            current: option === filters.period,
            text: t(`periods.${option}`),
          }))}
        />
        <FilterLinks
          label={t("source")}
          options={[undefined, ...sources].map((option) => ({
            key: option ?? "all",
            href: filterHref(filters, { source: option }),
            current: option === filters.source,
            text: option ? t(`sources.${option}`) : t("all"),
          }))}
        />
        <FilterLinks
          label={t("state")}
          options={[
            {
              key: "all",
              href: filterHref(filters, { state: undefined }),
              current: !filters.state,
              text: (
                <>
                  {t("all")}
                  {count(allStates)}
                </>
              ),
            },
            ...counts.map((item) => ({
              key: item.state,
              href: filterHref(filters, { state: item.state }),
              current: item.state === filters.state,
              text: (
                <>
                  {t(`states.${item.state}`)}
                  {count(item.count)}
                </>
              ),
            })),
          ]}
        />
      </div>

      <p className="text-sm">
        {t("summary", {
          shown: verdicts.rows.length,
          total: verdicts.total,
        })}
      </p>

      {verdicts.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {filters.state || filters.source ? t("emptyFiltered") : t("empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("customer")}</TableHead>
              <TableHead>{t("page")}</TableHead>
              <TableHead>{t("suggestion")}</TableHead>
              <TableHead>{t("source")}</TableHead>
              <TableHead>{t("changedAt")}</TableHead>
              <TableHead>{t("crawledAt")}</TableHead>
              <TableHead>{t("window")}</TableHead>
              <TableHead>{t("state")}</TableHead>
              <TableHead>{t("reason")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {verdicts.rows.map((row) => (
              <TableRow key={row.id} className="align-top">
                <TableCell>
                  <p className="font-medium">{row.projectName}</p>
                  <p className="text-muted-foreground text-xs">
                    {row.organizationSlug ?? t("none")}
                  </p>
                </TableCell>
                <TableCell className="max-w-xs text-xs break-all whitespace-normal">
                  {row.pageUrl}
                </TableCell>
                <TableCell className="max-w-xs text-xs whitespace-normal">
                  {row.suggestionTitle ?? t("none")}
                </TableCell>
                <TableCell className="text-xs">
                  {t(`sources.${row.changeSource}`)}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {when(row.changedAt)}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {row.crawledAt ? when(row.crawledAt) : t("notYet")}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {row.windowStart && row.windowEnd ? (
                    <>
                      <p>
                        {t("windowRange", {
                          start: day(row.windowStart),
                          end: day(row.windowEnd),
                        })}
                      </p>
                      {row.windowReadyOn ? (
                        <p className="text-muted-foreground">
                          {t("readyOn", { date: day(row.windowReadyOn) })}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    t("notYet")
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {t(`states.${row.state}`)}
                </TableCell>
                <TableCell className="max-w-xs text-xs whitespace-normal">
                  {row.reason ? t(`reasons.${row.reason}`) : t("none")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
