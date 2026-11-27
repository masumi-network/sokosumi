"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
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
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { seoFoldCount } from "./seo-list-model";
import { SeoSpeedDetail } from "./seo-page-speed";
import {
  SEO_STACKED_TABLE_CLASS,
  SeoDate,
  SeoPageLink,
  SeoSection,
  SeoShowMore,
  seoPageName,
  seoSiteUrl,
} from "./seo-shared";
import { seoDeviceReason, seoSiteSpeedRows } from "./seo-speed-model";
import { SeoSpeedMark, seoSpeedVerdictText } from "./seo-speed-status";

const COLUMNS = ["page", "tier", "devices", "status", "source"] as const;

/** The speed of the site's main pages: one row per page, the slowest first. A row opens its measurements. */
export function SeoSiteSpeed({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useSeoResultTranslations("App.Seo");
  const format = useSeoResultFormatter();
  const id = useId();
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const speed = workspace.siteSpeed;
  if (!speed) return null;
  const header = {
    lang: "en",
    title: t("siteSpeed.title"),
    description: t("siteSpeed.description"),
    actions: (
      <span className="text-muted-foreground text-xs">
        {t("pageSpeed.date")} <SeoDate report day value={speed.observedAt} />
      </span>
    ),
  };
  const notChecked = speed.notChecked?.count ? (
    <p className="text-muted-foreground px-2 text-sm">
      {t("siteSpeed.notChecked", {
        count: speed.notChecked.count,
        reason: t(`siteSpeed.gap.${speed.notChecked.reason}`),
      })}
    </p>
  ) : null;
  // An audit that tested no page still says how many pages wait, and why.
  if (!speed.rows.length)
    return notChecked && <SeoSection {...header}>{notChecked}</SeoSection>;
  const rows = seoSiteSpeedRows(speed);
  const fold = seoFoldCount(rows.length);
  const site = seoSiteUrl(workspace);
  // A column of "No trend yet" on every row says nothing: it shows once Core sent earlier weeks for a row.
  const columns = rows.some(({ history }) => history)
    ? ([...COLUMNS, "trend"] as const)
    : COLUMNS;
  const percent = (share: number) =>
    format.number(share, { style: "percent", maximumFractionDigits: 0 });
  return (
    <SeoSection {...header}>
      <div className={HOLDER_ITEM_CLASS}>
        <Table className={SEO_STACKED_TABLE_CLASS}>
          <TableHeader>
            <TableRow>
              {columns.map((key) => (
                <TableHead key={key} scope="col">
                  {t(`siteSpeed.column.${key}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(all ? rows : rows.slice(0, fold)).map(
              ({ row, verdict, trend }, index) => {
                const isOpen = open === row.url;
                const detailId = `${id}-${index}`;
                const reason = row.check && seoDeviceReason(row.check);
                const added = row.audited
                  ? t("siteSpeed.audited")
                  : row.cause
                    ? t(`siteSpeed.cause.${row.cause}`)
                    : null;
                return [
                  <TableRow key={row.url}>
                    <TableCell className="whitespace-normal">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        // The detail row exists only while open.
                        aria-controls={isOpen ? detailId : undefined}
                        onClick={() => setOpen(isOpen ? null : row.url)}
                        className="focus-visible:ring-ring inline-flex min-h-10 items-center gap-1.5 rounded-sm text-left font-medium break-all focus-visible:ring-2 focus-visible:outline-none sm:min-h-8"
                      >
                        {seoPageName(row.url, site, t("pages.home"))}
                        <ChevronDown
                          className={cn(
                            "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                            isOpen && "rotate-180",
                          )}
                          aria-hidden
                        />
                      </button>
                    </TableCell>
                    <TableCell data-label={t("siteSpeed.column.tier")}>
                      {row.tier && t(`siteSpeed.tier.${row.tier}`)}
                    </TableCell>
                    <TableCell data-label={t("siteSpeed.column.devices")}>
                      {row.devices
                        .map(({ device }) => t(`breakdown.devices.${device}`))
                        .join(", ")}
                    </TableCell>
                    <TableCell
                      data-label={t("siteSpeed.column.status")}
                      className="whitespace-normal"
                    >
                      <SeoSpeedMark status={verdict.worst}>
                        {seoSpeedVerdictText(t, verdict)}
                      </SeoSpeedMark>
                    </TableCell>
                    <TableCell
                      data-label={t("siteSpeed.column.source")}
                      className="whitespace-normal"
                    >
                      {verdict.source &&
                        t(`pageSpeed.source.${verdict.source}`)}
                    </TableCell>
                    {columns.length > COLUMNS.length && (
                      <TableCell data-label={t("siteSpeed.column.trend")}>
                        {t(`siteSpeed.trend.${trend ?? "none"}`)}
                      </TableCell>
                    )}
                  </TableRow>,
                  isOpen && (
                    <TableRow
                      key={`${row.url} detail`}
                      id={detailId}
                      className="hover:bg-transparent"
                    >
                      <TableCell
                        colSpan={columns.length}
                        className="space-y-3 whitespace-normal"
                      >
                        <SeoPageLink url={row.url} quiet />
                        {/* Core's sentence says why the page is in the table; the label is for a row without one. */}
                        {(row.why ?? added) && (
                          <p className="text-muted-foreground max-w-prose text-xs">
                            {row.why ?? added}
                          </p>
                        )}
                        {row.check && (
                          <p className="text-muted-foreground max-w-prose text-xs">
                            {reason &&
                              t(`siteSpeed.deviceReason.${reason.basis}`, {
                                device: t(
                                  `breakdown.devices.${row.check.device}`,
                                ).toLowerCase(),
                                share: percent(reason.share ?? 0),
                              })}
                            {row.check.mix && (
                              <>
                                {" "}
                                {t("siteSpeed.mix", {
                                  phone: percent(row.check.mix.phone),
                                  desktop: percent(row.check.mix.desktop),
                                  tablet: percent(row.check.mix.tablet),
                                })}
                              </>
                            )}
                            {row.check.notChecked && (
                              <> {t(`siteSpeed.gap.${row.check.notChecked}`)}</>
                            )}
                          </p>
                        )}
                        {row.devices.length ? (
                          <SeoSpeedDetail
                            pageUrl={row.url}
                            devices={row.devices}
                          />
                        ) : (
                          // A checked tier with no device read nothing Core could show; only tier none was not checked.
                          <p>
                            {t(
                              row.tier !== "none"
                                ? "pageSpeed.noReadable"
                                : "pageSpeed.not_checked",
                            )}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ),
                ];
              },
            )}
          </TableBody>
        </Table>
      </div>
      {notChecked}
      {rows.length > fold && (
        <SeoShowMore
          more={t("siteSpeed.showMore", { count: rows.length - fold })}
          expanded={all}
          onToggle={() => setAll(!all)}
        />
      )}
    </SeoSection>
  );
}
