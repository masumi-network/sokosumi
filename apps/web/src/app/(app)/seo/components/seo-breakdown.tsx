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
import { SEO_STACKED_TABLE_CLASS, SeoPeriod, SeoSection } from "./seo-shared";
import { seoQueryPeriod } from "./seo-statistics-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Countries past this many fold into one "more countries" line. */
export const SEO_BREAKDOWN_SHOWN = 10;

/** Search Console totals for the selected pages by country and by device. */
export function SeoBreakdown({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const locale = useLocale();
  const source = model.data.searchQueries;
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
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {countries?.rows.length ? (
          <BreakdownTable
            heading={t("breakdown.country")}
            rows={countries.rows}
            name={country}
            truncated={countries.truncated}
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
          />
        ) : null}
      </div>
    </SeoSection>
  );
}

function BreakdownTable({
  heading,
  rows,
  name,
  truncated,
}: {
  heading: string;
  rows: ProjectSeoSearchBreakdown["rows"];
  name: (key: string) => string;
  truncated: boolean;
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
              <TableCell className="font-medium whitespace-normal">
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
                className="text-right tabular-nums"
                data-label={t("queries.position")}
              >
                {format.number(row.averagePosition, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {more > 0 || truncated ? (
        <p className="text-muted-foreground px-3 py-2 text-xs">
          {[
            more > 0 ? t("breakdown.more", { count: more }) : null,
            truncated ? t("breakdown.truncated", { count: rows.length }) : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
    </div>
  );
}
