"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { createDataTableSchema } from "@sokosumi/utils";
import { Download, Ellipsis, Loader2, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  finishTableCopy,
  type TableCopy,
  tableCopyRows,
} from "@/app/drive/tables/table-copy";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { seoAuditName } from "./seo-audit-name";
import { seoCsv } from "./seo-csv";
import { type SeoExport, seoTablePlan } from "./seo-export-model";

/** A byte order mark, so a spreadsheet opens the file as UTF-8 and keeps umlauts and accents. */
const UTF8_BOM = "﻿";
/** The toasts carry the way to the new Table or how to finish it: they stay until dismissed. */
const STAY = { duration: Infinity, closeButton: true };
const TITLE_MAX = createDataTableSchema.shape.title.maxLength ?? 160;

/**
 * The exports of one list behind one button beside its title or filters: a CSV file named "<name>-<today>.csv", or a copy
 * into a new Files Table, a snapshot that SEO does not update. The table is built on the press only. A failed copy
 * finishes on the next press: the same Table and the batches not yet saved, under the same keys.
 */
export function SeoExportMenu({
  name,
  titleKey,
  workspace,
  table,
  tableCopy = table,
  empty = false,
  showTitle = false,
}: {
  name: string;
  /** The list's title: a tab can hold two lists, so the button's name says which one it exports. */
  titleKey: Parameters<IntlTranslation<"App.Seo">>[0];
  /** The audit: its site names the Table, and the Table joins its project. */
  workspace: Pick<
    ProjectSeoWorkspace,
    "auditName" | "websiteUrl" | "projectId"
  >;
  table: (report: IntlTranslation<"App.Seo">) => SeoExport;
  /** The rows of the Table copy, where it holds more columns than the CSV keeps. */
  tableCopy?: (report: IntlTranslation<"App.Seo">) => SeoExport;
  /**
   * A search left no row: there is nothing to export. The menu stays, so a failed copy can still finish with the
   * rows it planned.
   */
  empty?: boolean;
  showTitle?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const report = useSeoResultTranslations("App.Seo");
  const reportFormat = useSeoResultFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const attempt = useRef<TableCopy | null>(null);
  const site = seoAuditName(
    workspace.auditName ?? "",
    workspace.websiteUrl ?? "",
  );

  function download() {
    const { header, rows } = table(report);
    const url = URL.createObjectURL(
      new Blob([UTF8_BOM, seoCsv(header, rows, locale)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    // After the click has started the download.
    setTimeout(() => URL.revokeObjectURL(url));
  }

  // A project name may be longer than a Table title: the site gives way, the date stays.
  function tableTitle(now: Date) {
    const named = (site: string) =>
      report("export.tableTitle", {
        table: report(titleKey),
        site,
        date: reportFormat.dateTime(now, { dateStyle: "medium" }),
      });
    const over = named(site).length - TITLE_MAX;
    if (over <= 0) return named(site);
    // The limit counts UTF-16 units: a cut inside an emoji drops its lone first half.
    const cut = site.slice(0, -over - 1).replace(/[\uD800-\uDBFF]$/, "");
    return named(`${cut}…`);
  }

  async function copy() {
    setPending(true);
    try {
      if (!attempt.current) {
        const now = new Date();
        attempt.current = {
          done: 0,
          plan: seoTablePlan(
            tableCopy(report),
            {
              title: tableTitle(now),
              description: report("export.tableDescription", {
                date: reportFormat.dateTime(now, "dateTimeMedium"),
              }),
              projectId: workspace.projectId,
            },
            crypto.randomUUID(),
          ),
        };
      }
      const current = attempt.current;
      // A retry resumes at the first batch not saved.
      const id = await finishTableCopy(current);
      attempt.current = null;
      toast.success(
        t("export.tableCopied", {
          count: tableCopyRows(current).total,
        }),
        {
          ...STAY,
          action: {
            label: t("export.openTable"),
            onClick: () => router.push(`/drive/tables/${id}`),
          },
        },
      );
    } catch {
      toast.error(t("export.tableFailed"), STAY);
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          // A full 40 px target below md, as every icon control; from md up the 32 px of the buttons beside it.
          className="text-muted-foreground md:size-8"
          aria-label={t("export.menu", { table: t(titleKey) })}
          // Busy, not unavailable: the menu still opens, and the CSV still downloads while a copy runs.
          aria-busy={pending || undefined}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Ellipsis className="size-4" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showTitle && <DropdownMenuLabel>{t(titleKey)}</DropdownMenuLabel>}
        <DropdownMenuItem disabled={empty} onSelect={download}>
          <Download aria-hidden />
          {t("export.csv")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending || (empty && !attempt.current)}
          onSelect={() => void copy()}
        >
          <Table2 aria-hidden />
          {t("export.table")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
