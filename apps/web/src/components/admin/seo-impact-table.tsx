import type { AdminSeoImpactVerdicts } from "@sokosumi/core-client";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminSeoImpactPeriod } from "@/lib/services/admin-seo-impact.service";
import { cn } from "@/lib/utils";

/**
 * Every tracked page change across customers: when it went live, when Google
 * first crawled it after that, the weeks a verdict compares, and why a row
 * still waits or cannot be measured.
 */
export async function SeoImpactTable({
  verdicts,
  period,
  periods,
}: {
  verdicts: AdminSeoImpactVerdicts;
  period: AdminSeoImpactPeriod;
  periods: AdminSeoImpactPeriod[];
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {t("summary", {
            shown: verdicts.rows.length,
            total: verdicts.total,
          })}
        </p>
        <nav className="flex gap-1" aria-label={t("period")}>
          {periods.map((option) => (
            <Link
              key={option}
              href={`/admin/seo-impact?period=${option}`}
              aria-current={option === period ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm",
                option === period
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`periods.${option}`)}
            </Link>
          ))}
        </nav>
      </div>

      {verdicts.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
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
