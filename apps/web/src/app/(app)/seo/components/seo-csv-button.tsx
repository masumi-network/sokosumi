"use client";

import { Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { seoCsv } from "./seo-csv";
import type { SeoExport } from "./seo-export-model";

/** A byte order mark, so a spreadsheet opens the file as UTF-8 and keeps umlauts and accents. */
const UTF8_BOM = "﻿";

/** Saves one table as a CSV file named "<name>-<today>.csv". The table is built on the press only. */
export function SeoCsvButton({
  name,
  title,
  table,
}: {
  name: string;
  /** The table's title: a tab can hold two tables, so the button's name says which one it saves. */
  title: string;
  table: () => SeoExport;
}) {
  const t = useTranslations("App.Seo");
  const locale = useLocale();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t("export.csvLabel", { table: title })}
      onClick={() => {
        const { header, rows } = table();
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
      }}
    >
      <Download className="size-4" />
      {t("export.csv")}
    </Button>
  );
}
