"use client";

import type { ProjectSeoSearchBreakdown } from "@sokosumi/core-client";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hiddenImpressions } from "./seo-search-model";
import { SEO_STACKED_TABLE_CLASS, SeoPeriod, SeoSection } from "./seo-shared";
import { seoQueryPeriod } from "./seo-statistics-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Countries past this many fold into one "more countries" line. */
export const SEO_BREAKDOWN_SHOWN = 10;

/** Search Console totals for the selected pages by country and by device. */
export function SeoBreakdown({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const locale = useLocale();
  // Its own source: a Discover or Google News sync has a split but no query rows.
  const source = model.data.searchBreakdown;
  const countries = source?.countries;
  const devices = source?.devices;
  if (!source || (!countries?.rows.length && !devices?.rows.length))
    return null;
  const regions = new Intl.DisplayNames([locale], { type: "region" });
  // Google names an unknown region "ZZZ"; other 3-letter codes have no alpha-2 name.
  const country = (key: string) =>
    key === "ZZZ"
      ? t("breakdown.unknownCountry")
      : key.length === 2
        ? (regions.of(key) ?? key)
        : key;
  // Google can leave impressions out of a split; say how many rows cover.
  const hidden = (dimension: "country" | "device") => {
    const split = dimension === "country" ? countries : devices;
    const count =
      source && split?.rows.length
        ? hiddenImpressions(model.data, { ...source, ...split })
        : null;
    return count?.hidden ? count : null;
  };
  const byCountry = hidden("country");
  const byDevice = hidden("device");
  // Both splits cover the same impressions: one note says so, not one per table.
  const shared =
    byCountry &&
    byDevice &&
    byCountry.listed === byDevice.listed &&
    byCountry.total === byDevice.total
      ? byCountry
      : null;
  const unlisted = (dimension: "country" | "device") => {
    const count = dimension === "country" ? byCountry : byDevice;
    return count && !shared
      ? t(`breakdown.unlisted.${dimension}`, {
          listed: count.listed,
          total: count.total,
        })
      : null;
  };
  return (
    <SeoSection
      title={t("breakdown.title")}
      description={
        <>
          {t("breakdown.help")} ·{" "}
          <SeoPeriod {...seoQueryPeriod(source, model.data.metrics)} />
        </>
      }
    >
      {/* Side by side only where each table has its 5 columns in full: the page's width says little, the section's says all. */}
      <div className="@container min-w-0">
        <div className="grid min-w-0 grid-cols-1 gap-3 @7xl:grid-cols-2">
          {countries?.rows.length ? (
            <BreakdownTable
              heading={t("breakdown.country")}
              rows={countries.rows}
              name={country}
              truncated={countries.truncated}
              unlisted={unlisted("country")}
            />
          ) : null}
          {devices?.rows.length ? (
            <BreakdownTable
              heading={t("breakdown.device")}
              rows={devices.rows}
              name={(key) =>
                t.has(`breakdown.devices.${key}`)
                  ? t(`breakdown.devices.${key}`)
                  : key
              }
              truncated={devices.truncated}
              unlisted={unlisted("device")}
            />
          ) : null}
        </div>
      </div>
      {shared ? (
        <p className="text-muted-foreground px-3 text-xs">
          {t("breakdown.unlisted.both", {
            listed: shared.listed,
            total: shared.total,
          })}
        </p>
      ) : null}
    </SeoSection>
  );
}

function BreakdownTable({
  heading,
  rows,
  name,
  truncated,
  unlisted,
}: {
  heading: string;
  rows: ProjectSeoSearchBreakdown["rows"];
  name: (key: string) => string;
  truncated: boolean;
  unlisted: string | null;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const shown = rows.slice(0, SEO_BREAKDOWN_SHOWN);
  const more = rows.length - shown.length;
  return (
    <div className={HOLDER_ITEM_CLASS}>
      <Table className={SEO_STACKED_TABLE_CLASS}>
        <TableHeader>
          <TableRow>
            <TableHead>{heading}</TableHead>
            <TableHead className="text-right">{t("queries.clicks")}</TableHead>
            <TableHead className="text-right">
              {t("queries.impressions")}
            </TableHead>
            <TableHead className="text-right">{t("queries.ctr")}</TableHead>
            <TableHead className="text-right">
              {t("queries.position")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow key={row.key}>
              {/* Node and the browser can ship different region names. */}
              <TableCell
                className="font-medium whitespace-normal"
                suppressHydrationWarning
              >
                {name(row.key)}
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
                {format.number(row.ctr, {
                  style: "percent",
                  maximumFractionDigits: 1,
                })}
              </TableCell>
              <TableCell
                // The last cell is a number here, not the row's actions: it keeps its half.
                className="text-right tabular-nums max-sm:col-span-1!"
                data-label={t("queries.position")}
              >
                {row.averagePosition === null
                  ? t("none")
                  : format.number(row.averagePosition, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {more > 0 || truncated || unlisted ? (
        <p className="text-muted-foreground px-3 py-2 text-xs">
          {[
            more > 0 ? t("breakdown.more", { count: more }) : null,
            truncated ? t("breakdown.truncated", { count: rows.length }) : null,
            unlisted,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
    </div>
  );
}
